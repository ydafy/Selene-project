import { useState, useEffect } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../db/supabase';
import { ProductCategory, ProductStatus } from '@selene/types';

export const useVerificationLogic = (productId?: string) => {
  const [loadingCategory, setLoadingCategory] = useState(true);
  const [category, setCategory] = useState<ProductCategory | null>(null);

  const [physicalUri, setPhysicalUri] = useState<string | null>(null);
  const [performanceUri, setPerformanceUri] = useState<string | null>(null);
  const [score, setScore] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [status, setStatus] = useState<ProductStatus>('PENDING_VERIFICATION');
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);

  // 1. Cargar Categoría
  useEffect(() => {
    const fetchProduct = async () => {
      if (!productId) return;
      const { data, error } = await supabase
        .from('products')
        .select('category, status, rejection_reason')
        .eq('id', productId)
        .single();

      if (!error && data) {
        setCategory(data.category as ProductCategory);
        setStatus(data.status as ProductStatus);
        setRejectionReason(data.rejection_reason);
      }
      setLoadingCategory(false);
    };
    fetchProduct();
  }, [productId]);

  // 2. Cámara
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

  // 3. Subida (Interna)
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

  // 4. Submit
  const submitVerification = async () => {
    if (!productId) return;
    setIsUploading(true);
    try {
      const physicalPath = physicalUri
        ? await uploadProof(physicalUri, 'physical')
        : null;

      // Determinar si subimos performance
      let performancePath = null;
      const requiresBenchmark = ['GPU', 'CPU'].includes(category || '');
      const requiresInfo = ['RAM', 'Motherboard'].includes(category || '');

      if ((requiresBenchmark || requiresInfo) && performanceUri) {
        performancePath = await uploadProof(
          performanceUri,
          requiresBenchmark ? 'bench' : 'info',
        );
      }

      if (!physicalPath) throw new Error('MISSING_PHYSICAL');

      const verificationData = {
        proof_physical: physicalPath,
        proof_performance: performancePath,
        benchmark_score: requiresBenchmark ? Number(score) : null,
        submitted_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('products')
        .update({
          status: 'IN_REVIEW',
          verification_data: verificationData,
        })
        .eq('id', productId);

      if (error) throw error;
      return 'SUCCESS';
    } catch (error) {
      console.error(error);
      throw error;
    } finally {
      setIsUploading(false);
    }
  };

  return {
    category,
    loadingCategory,
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
