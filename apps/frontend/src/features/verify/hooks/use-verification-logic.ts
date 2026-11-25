import { useState, useEffect, useCallback, useRef } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '@/shared/lib/supabase';
import { uploadMediaFromUri } from '@/shared/lib/upload-media';
import { ProductCategory, ProductStatus } from '@selene/types';
import {
  buildVerificationSubmission,
  describeError,
  readLatestAttempt,
  resolveVerificationRequirements,
  type VerificationLoadState,
} from '../logic/verification-submit';
import { buildVerificationProofUpload } from '../logic/verification-proof-upload';

// The owner reads its own attempts and their proofs (RLS on both tables, #651).
const fetchLatestAttempt = (productId: string) =>
  supabase
    .from('product_verifications')
    .select(
      'decision, public_note, benchmark_score, product_verification_evidence(kind, storage_path)',
    )
    .eq('product_id', productId)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

export const useVerificationLogic = (productId?: string) => {
  const [loadState, setLoadState] = useState<VerificationLoadState>('loading');
  const [reloadKey, setReloadKey] = useState(0);
  const [category, setCategory] = useState<ProductCategory | null>(null);

  const [physicalUri, setPhysicalUri] = useState<string | null>(null);
  const [performanceUri, setPerformanceUri] = useState<string | null>(null);
  const [score, setScore] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const submittingRef = useRef(false);
  const [status, setStatus] = useState<ProductStatus>('pending_verification');
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  // Load the product before the form can be used; a failure must not relax the requirements.
  useEffect(() => {
    let active = true;
    const fetchProduct = async () => {
      if (!productId) {
        setLoadState('error');
        return;
      }
      setLoadState('loading');
      const { data, error } = await supabase
        .from('products')
        .select('category, status')
        .eq('id', productId)
        .single();

      if (!active) return;
      if (error || !data) {
        console.error('[verification] load failed', describeError(error));
        setLoadState('error');
        return;
      }

      const { data: attempt, error: attemptError } =
        await fetchLatestAttempt(productId);
      if (!active) return;
      if (attemptError) {
        console.error(
          '[verification] load failed',
          describeError(attemptError),
        );
        setLoadState('error');
        return;
      }

      const latest = readLatestAttempt(attempt);
      setCategory(data.category as ProductCategory);
      setStatus(data.status as ProductStatus);
      setRejectionReason(latest.rejectionReason);

      // Previously submitted proofs are shown through short-lived signed URLs;
      // untouched proofs keep their stored paths on resubmission.
      if (latest.benchmarkScore !== null) {
        setScore(String(latest.benchmarkScore));
      }
      if (latest.physicalPath) {
        const { data: signed } = await supabase.storage
          .from('verification')
          .createSignedUrl(latest.physicalPath, 3600);
        if (active && signed) setPhysicalUri(signed.signedUrl);
      }
      if (latest.performancePath) {
        const { data: signed } = await supabase.storage
          .from('verification')
          .createSignedUrl(latest.performancePath, 3600);
        if (active && signed) setPerformanceUri(signed.signedUrl);
      }
      if (active) setLoadState('ready');
    };
    fetchProduct();
    return () => {
      active = false;
    };
  }, [productId, reloadKey]);

  //  Cámara
  const handleCamera = async (target: 'physical' | 'performance') => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return 'PERMISSION_DENIED'; // Retornamos estado en vez de Alert

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.6,
      allowsEditing: false,
    });

    if (!result.canceled) {
      if (target === 'physical') setPhysicalUri(result.assets[0].uri);
      else setPerformanceUri(result.assets[0].uri);
      return 'SUCCESS';
    }
    return 'CANCELED';
  };

  //  Subida (Interna)
  const uploadProof = async (uri: string, prefix: string) =>
    uploadMediaFromUri({
      storage: supabase.storage,
      uri,
      ...buildVerificationProofUpload(productId, prefix, uri, Date.now()),
    });

  //  Submit
  const submitVerification = async () => {
    if (submittingRef.current) return 'BUSY';
    if (!productId || !category) throw new Error('VERIFICATION_NOT_READY');
    submittingRef.current = true;
    setIsUploading(true);
    try {
      // Remote (http) URIs are proofs already stored; only new local files are uploaded.
      // The latest attempt is re-read so an untouched proof keeps its path.
      const { data: attempt, error: readError } =
        await fetchLatestAttempt(productId);
      if (readError) throw readError;
      const previous = readLatestAttempt(attempt);

      let physicalPath = previous.physicalPath;
      if (physicalUri && !physicalUri.startsWith('http')) {
        physicalPath = await uploadProof(physicalUri, 'physical');
      }

      const { requiresBenchmark } = resolveVerificationRequirements(category);
      let performancePath = previous.performancePath;
      if (performanceUri && !performanceUri.startsWith('http')) {
        performancePath = await uploadProof(
          performanceUri,
          requiresBenchmark ? 'bench' : 'info',
        );
      }

      // Only the server records an attempt and moves the listing to review (S3).
      const { data: verificationId, error } = await supabase.rpc(
        'fn_submit_product_verification',
        buildVerificationSubmission({
          productId,
          category,
          score,
          physicalPath,
          performancePath,
        }),
      );

      if (error) throw error;
      if (!verificationId) {
        throw new Error('VERIFICATION_SUBMIT_NO_ATTEMPT');
      }
      return 'SUCCESS';
    } catch (error) {
      console.error('[verification] submit failed', describeError(error));
      throw error;
    } finally {
      submittingRef.current = false;
      setIsUploading(false);
    }
  };

  return {
    category,
    loadState,
    reload,
    physicalUri,
    performanceUri,
    status,
    rejectionReason,
    score,
    setScore,
    isUploading,
    handleCamera,
    submitVerification,
  };
};
