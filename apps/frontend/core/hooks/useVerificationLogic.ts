import { useState, useEffect, useCallback, useRef } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../db/supabase';
import { ProductCategory, ProductStatus } from '@selene/types';
import {
  buildVerificationData,
  describeError,
  resolveVerificationRequirements,
  type VerificationLoadState,
} from '../utils/verification-submit';

export const useVerificationLogic = (productId?: string) => {
  const [loadState, setLoadState] = useState<VerificationLoadState>('loading');
  const [reloadKey, setReloadKey] = useState(0);
  const [category, setCategory] = useState<ProductCategory | null>(null);

  const [physicalUri, setPhysicalUri] = useState<string | null>(null);
  const [performanceUri, setPerformanceUri] = useState<string | null>(null);
  const [score, setScore] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const submittingRef = useRef(false);
  const [status, setStatus] = useState<ProductStatus>('PENDING_VERIFICATION');
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
        .select('category, status, rejection_reason, verification_data')
        .eq('id', productId)
        .single();

      if (!active) return;
      if (error || !data) {
        console.error('[verification] load failed', describeError(error));
        setLoadState('error');
        return;
      }

      setCategory(data.category as ProductCategory);
      setStatus(data.status as ProductStatus);
      setRejectionReason(data.rejection_reason);

      // Previously submitted proofs are shown through short-lived signed URLs;
      // untouched proofs keep their stored paths on resubmission.
      if (data.verification_data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const vData = data.verification_data as any;

        if (vData.benchmark_score) setScore(String(vData.benchmark_score));

        if (vData.proof_physical) {
          const { data: signed } = await supabase.storage
            .from('verification')
            .createSignedUrl(vData.proof_physical, 3600);
          if (active && signed) setPhysicalUri(signed.signedUrl);
        }
        if (vData.proof_performance) {
          const { data: signed } = await supabase.storage
            .from('verification')
            .createSignedUrl(vData.proof_performance, 3600);
          if (active && signed) setPerformanceUri(signed.signedUrl);
        }
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
  const uploadProof = async (uri: string, prefix: string) => {
    const response = await fetch(uri);
    const blob = await response.arrayBuffer();
    const ext = uri.split('.').pop() || 'jpg';
    const path = `${productId}/${prefix}_${Date.now()}.${ext}`;

    const { error, data } = await supabase.storage
      .from('verification')
      .upload(path, blob, { contentType: `image/${ext}`, upsert: true });

    if (error) throw error;
    return data.path;
  };

  //  Submit
  const submitVerification = async () => {
    if (submittingRef.current) return 'BUSY';
    if (!productId || !category) throw new Error('VERIFICATION_NOT_READY');
    submittingRef.current = true;
    setIsUploading(true);
    try {
      // Remote (http) URIs are proofs already stored; only new local files are uploaded.
      // The stored paths are re-read so an untouched proof keeps its path.
      const { data: currentData, error: readError } = await supabase
        .from('products')
        .select('verification_data')
        .eq('id', productId)
        .single();
      if (readError) throw readError;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const oldVData = (currentData?.verification_data as any) || {};

      let physicalPath: string | undefined = oldVData.proof_physical;
      if (physicalUri && !physicalUri.startsWith('http')) {
        physicalPath = await uploadProof(physicalUri, 'physical');
      }

      const { requiresBenchmark } = resolveVerificationRequirements(category);
      let performancePath: string | undefined = oldVData.proof_performance;
      if (performanceUri && !performanceUri.startsWith('http')) {
        performancePath = await uploadProof(
          performanceUri,
          requiresBenchmark ? 'bench' : 'info',
        );
      }

      const verificationData = buildVerificationData({
        category,
        score,
        physicalPath,
        performancePath,
        submittedAt: new Date().toISOString(),
      });

      const { data: updated, error } = await supabase
        .from('products')
        .update({
          status: 'IN_REVIEW',
          verification_data: verificationData,
          rejection_reason: null, // Limpiamos el rechazo al reenviar
        })
        .eq('id', productId)
        .select('id');

      if (error) throw error;
      // RLS can filter the row out without an error; that is not a submission.
      if (!updated || updated.length !== 1) {
        throw new Error('VERIFICATION_UPDATE_NO_ROW');
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
