export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface CreateDisputeEvidence {
  images: string[];
  tech_checklist: Record<string, boolean>;
  video_url?: string | null;
}

export interface CreateDisputeRequestBody {
  orderId: string;
  shipmentId: string;
  reason: string;
  description: string;
  evidence: CreateDisputeEvidence;
}

function assertString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(message);
  }

  return value.trim();
}

function assertUuid(value: string, message: string): string {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(value)) throw new Error(message);
  return value;
}

function assertUrl(value: string, message: string): string {
  try {
    new URL(value);
    return value;
  } catch {
    throw new Error(message);
  }
}

function parseEvidence(value: unknown): CreateDisputeEvidence {
  if (!value || typeof value !== 'object')
    throw new Error('Evidence is required');

  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.images) || record.images.length === 0) {
    throw new Error('At least one evidence image is required');
  }

  const images = record.images.map((image) =>
    assertUrl(
      assertString(image, 'Evidence image URL is required'),
      'Evidence images must be valid URLs',
    ),
  );

  if (!record.tech_checklist || typeof record.tech_checklist !== 'object') {
    throw new Error('Tech checklist is required');
  }

  const techChecklist = record.tech_checklist as Record<string, unknown>;
  for (const value of Object.values(techChecklist)) {
    if (typeof value !== 'boolean')
      throw new Error('Tech checklist values must be boolean');
  }

  const videoUrl =
    record.video_url === undefined || record.video_url === null
      ? null
      : assertUrl(
          assertString(record.video_url, 'Video URL is invalid'),
          'Video URL is invalid',
        );

  return {
    images,
    tech_checklist: techChecklist as Record<string, boolean>,
    video_url: videoUrl,
  };
}

export function parseCreateDisputeRequestBody(
  body: unknown,
): CreateDisputeRequestBody {
  if (!body || typeof body !== 'object')
    throw new Error('Request body is required');

  const record = body as Record<string, unknown>;
  const orderId = assertUuid(
    assertString(record.orderId, 'Order ID is required'),
    'Invalid order ID',
  );
  const shipmentId = assertUuid(
    assertString(record.shipmentId, 'Required'),
    'Invalid shipment ID',
  );
  const reason = assertString(record.reason, 'Reason is required');
  const description = assertString(
    record.description,
    'Description is required',
  );
  if (description.length < 10)
    throw new Error('Description must be more detailed');

  return {
    orderId,
    shipmentId,
    reason,
    description,
    evidence: parseEvidence(record.evidence),
  };
}

export function mapDisputeErrorCode(errorCode: string): ApiError {
  if (errorCode.startsWith('DISPUTE_STATUS_NOT_ALLOWED:')) {
    return new ApiError(422, errorCode);
  }

  switch (errorCode) {
    case 'SHIPMENT_NOT_FOUND':
      return new ApiError(404, 'Envío no encontrado');
    case 'SHIPMENT_ORDER_MISMATCH':
      return new ApiError(400, errorCode);
    case 'ORDER_BUYER_MISMATCH':
      return new ApiError(403, errorCode);
    case 'DISPUTE_WINDOW_EXPIRED':
      return new ApiError(422, errorCode);
    case 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE':
      return new ApiError(409, errorCode);
    case 'DISPUTE_ALREADY_EXISTS':
      return new ApiError(409, 'Ya existe una disputa abierta para este paquete.');
    default:
      return new ApiError(500, `Error al crear disputa: ${errorCode}`);
  }
}
