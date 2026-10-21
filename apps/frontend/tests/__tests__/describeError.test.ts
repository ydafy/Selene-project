import { describe, expect, it } from 'bun:test';
import { describeError } from '../../core/utils/describe-error';

describe('describeError', () => {
  it('keeps our own error codes as the message', () => {
    expect(describeError(new Error('MEDIA_READ_FAILED'))).toEqual({
      name: 'Error',
      message: 'MEDIA_READ_FAILED',
      code: undefined,
      status: undefined,
    });
  });

  it('drops free-text messages that may carry private details', () => {
    expect(describeError(new Error('upload failed for shipments/order/user/a.jpg')).message).toBeUndefined();
    expect(describeError('private details')).toEqual({ message: undefined });
    expect(describeError(new Error('SYNTHETIC_PRIVATE_UPLOAD_MARKER')).message).toBeUndefined();
  });

  it('keeps provider code and status', () => {
    expect(describeError({ name: 'StorageApiError', message: 'Bucket not found', statusCode: '404', code: 'NoSuchBucket' })).toEqual({
      name: 'StorageApiError',
      message: undefined,
      code: 'NoSuchBucket',
      status: '404',
    });
  });
});
