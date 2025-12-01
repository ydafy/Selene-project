import { Share } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Product } from '@selene/types';

export const useProductShare = (product: Product | undefined) => {
  const { t } = useTranslation('product');

  const handleShare = async () => {
    if (!product) return;

    try {
      const productLink = `selene://product/${product.id}`;
      await Share.share({
        message: t('product:actions.shareMessage', {
          productName: product.name,
          productLink: productLink,
        }),
        title: t('product:actions.shareTitle', {
          productName: product.name,
        }),
        url: productLink,
      });
    } catch (error) {
      console.error(error);
    }
  };

  return { handleShare };
};
