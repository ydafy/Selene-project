/**
 * Extrae el path relativo de una URL de Supabase Storage.
 * Si recibe un path, lo devuelve igual. Si recibe una URL, extrae lo que sigue después del nombre del bucket.
 */
export const getStoragePath = (input: string, bucketName: string) => {
  if (!input) return '';
  if (!input.startsWith('http')) return input; // Ya es un path

  // Buscamos la parte de la URL después del nombre del bucket
  const parts = input.split(`${bucketName}/`);
  return parts.length > 1 ? parts[1] : input;
};
