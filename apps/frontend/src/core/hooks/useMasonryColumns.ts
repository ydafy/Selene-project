import { useMemo } from 'react';
import { Product } from '@selene/types';

/**
 * Hook para dividir una lista de productos en dos columnas para un layout Masonry.
 * @param products - Lista completa de productos.
 */
export const useMasonryColumns = (products: Product[] | undefined) => {
  const { left, right } = useMemo(() => {
    if (!products) return { left: [], right: [] };

    const leftCol: Product[] = [];
    const rightCol: Product[] = [];

    products.forEach((item, index) => {
      if (index % 2 === 0) {
        leftCol.push(item);
      } else {
        rightCol.push(item);
      }
    });

    return { left: leftCol, right: rightCol };
  }, [products]);

  return { leftColumn: left, rightColumn: right };
};
