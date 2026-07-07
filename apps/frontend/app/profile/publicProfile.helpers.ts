export type PublicProfileCollectionState =
  | 'error'
  | 'loading'
  | 'empty'
  | 'ready';

type PublicProfileCollectionStateInput = {
  error: unknown;
  isLoading: boolean;
  itemCount: number;
};

export const resolvePublicProfileSellerId = (
  id: string | string[] | undefined,
) => (typeof id === 'string' && id.trim().length > 0 ? id.trim() : null);

export const shouldHidePublicProfileModerationActions = (
  viewerId: string | undefined,
  sellerId: string | null,
) => Boolean(viewerId && sellerId && viewerId === sellerId);

export const resolvePublicProfileCollectionState = ({
  error,
  isLoading,
  itemCount,
}: PublicProfileCollectionStateInput): PublicProfileCollectionState => {
  if (error) {
    return 'error';
  }

  if (isLoading) {
    return 'loading';
  }

  return itemCount > 0 ? 'ready' : 'empty';
};
