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

  // Cargar Categoría
  useEffect(() => {
    const fetchProduct = async () => {
      if (!productId) return;
      const { data, error } = await supabase
        .from('products')
        .select('category, status, rejection_reason, verification_data') // <--- Traemos verification_data
        .eq('id', productId)
        .single();

      if (!error && data) {
        setCategory(data.category as ProductCategory);
        setStatus(data.status as ProductStatus);
        setRejectionReason(data.rejection_reason);

        // MAGIA DE PERSISTENCIA: Si ya hay datos, los cargamos
        if (data.verification_data) {
          // Nota: verification_data tiene los paths internos de Supabase.
          // Para mostrarlos en la UI (Image source), necesitamos URLs firmadas.
          // OJO: Si el usuario va a "Cambiar Foto", usará una URI local.
          // Si mantenemos la vieja, necesitamos descargarla o generar URL firmada.

          // ESTRATEGIA HÍBRIDA:
          // Por simplicidad y performance, generamos URLs firmadas temporales para pre-llenar la vista.
          // Si el usuario no toca nada, re-enviamos los paths existentes.

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const vData = data.verification_data as any;

          if (vData.benchmark_score) setScore(String(vData.benchmark_score));

          // Generar URLs para visualización
          if (vData.proof_physical) {
            const { data: signed } = await supabase.storage
              .from('verification')
              .createSignedUrl(vData.proof_physical, 3600);
            if (signed) setPhysicalUri(signed.signedUrl);
          }
          if (vData.proof_performance) {
            const { data: signed } = await supabase.storage
              .from('verification')
              .createSignedUrl(vData.proof_performance, 3600);
            if (signed) setPerformanceUri(signed.signedUrl);
          }
        }
      }
      setLoadingCategory(false);
    };
    fetchProduct();
  }, [productId]);

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
    if (!productId) return;
    setIsUploading(true);
    try {
      // Lógica inteligente:
      // Si la URI empieza con 'http' (es de Supabase), NO subimos de nuevo, buscamos el path original en DB.
      // Si la URI empieza con 'file://' (es nueva), subimos.

      // Para simplificar este MVP y no hacer doble query:
      // Si es URL remota, asumimos que NO cambió y no la subimos, pero necesitamos recuperar su path relativo.
      // TRUCO: Vamos a volver a leer la DB para obtener los paths viejos si no subimos nuevos.

      const { data: currentData } = await supabase
        .from('products')
        .select('verification_data')
        .eq('id', productId)
        .single();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const oldVData = (currentData?.verification_data as any) || {};

      let physicalPath = oldVData.proof_physical;
      if (physicalUri && !physicalUri.startsWith('http')) {
        physicalPath = await uploadProof(physicalUri, 'physical');
      }

      let performancePath = oldVData.proof_performance;
      if (performanceUri && !performanceUri.startsWith('http')) {
        const requiresBenchmark = ['GPU', 'CPU'].includes(category || '');
        performancePath = await uploadProof(
          performanceUri,
          requiresBenchmark ? 'bench' : 'info',
        );
      }

      const verificationData = {
        proof_physical: physicalPath,
        proof_performance: performancePath,
        benchmark_score: ['GPU', 'CPU'].includes(category || '')
          ? Number(score)
          : null,
        submitted_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('products')
        .update({
          status: 'IN_REVIEW',
          verification_data: verificationData,
          rejection_reason: null, // Limpiamos el rechazo al reenviar
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
