type PaymentSheetInitConfig = {
  merchantDisplayName: string;
  paymentIntentClientSecret: string;
  customerId: string;
  customerEphemeralKeySecret: string;
  allowsDelayedPaymentMethods: boolean;
  appearance: {
    shapes: { borderRadius: number };
    colors: Record<string, string>;
  };
};

type PaymentSheetInitResult = {
  error?: { message: string } | null;
};

type PaymentSheetPresentResult = {
  error?: { code?: string; message: string } | null;
};

export type SinglePaymentSheetDependencies = {
  initPaymentSheet: (
    config: PaymentSheetInitConfig,
  ) => Promise<PaymentSheetInitResult>;
  presentPaymentSheet: () => Promise<PaymentSheetPresentResult>;
};

export type SinglePaymentSheetInput = PaymentSheetInitConfig &
  SinglePaymentSheetDependencies;

export type SinglePaymentSheetResult =
  | { success: true }
  | { success: false; message: string; cancelled?: true };

export async function presentSinglePaymentSheet({
  initPaymentSheet,
  presentPaymentSheet,
  ...config
}: SinglePaymentSheetInput): Promise<SinglePaymentSheetResult> {
  const { error: initError } = await initPaymentSheet(config);

  if (initError) {
    return { success: false, message: initError.message };
  }

  const { error: sheetError } = await presentPaymentSheet();

  if (sheetError) {
    return {
      success: false,
      cancelled: sheetError.code === 'Canceled' ? true : undefined,
      message: sheetError.message,
    };
  }

  return { success: true };
}
