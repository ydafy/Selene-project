import {
  ACCOUNT_DELETION_PATH,
  PRIVACY_PATH,
  SELENE_SUPPORT_EMAIL,
} from '@selene/types';
import { PublicPage, PublicSection } from '../components/public/PublicPage';

export function TermsPage() {
  return (
    <PublicPage title="Términos y condiciones de Selene">
      <p
        role="note"
        className="rounded-lg bg-fire/10 p-3 text-sm text-fire border border-fire/20"
      >
        Este es un resumen de cómo funciona Selene. Los términos y condiciones
        completos están pendientes de revisión legal y no deben presentarse como
        definitivos.
      </p>

      <PublicSection title="Qué es Selene">
        <p>
          Selene es un mercado entre particulares en México para comprar y
          vender hardware de PC usado. Selene revisa técnicamente las
          publicaciones y resguarda el pago entre comprador y vendedor.
        </p>
      </PublicSection>

      <PublicSection title="Seguro Selene">
        <p>
          Quien compra paga el precio del producto más el Seguro Selene, que
          cubre la comisión de procesamiento del pago. Los pagos se procesan a
          través de Stripe.
        </p>
      </PublicSection>

      <PublicSection title="Ventas y pagos al vendedor">
        <p>
          Quien vende absorbe el costo del envío y la comisión de Selene. Selene
          retiene el pago y lo libera completo al vendedor después de que el
          envío se completa.
        </p>
      </PublicSection>

      <PublicSection title="Reembolsos y disputas">
        <p>
          Un reembolso o una disputa solo puede abrirse antes de que el envío se
          complete, y siempre se refiere a un envío de un vendedor, no al pedido
          completo.
        </p>
      </PublicSection>

      <PublicSection title="Suspensión y bloqueo de cuentas">
        <p>
          Selene puede suspender una cuenta de forma temporal para contener un
          riesgo. Mientras está suspendida no puede publicar, recibir ventas
          nuevas ni pedir retiros; los pedidos y envíos ya iniciados siguen su
          curso. Una cuenta se bloquea de forma definitiva por fraude o intento
          claro de fraude.
        </p>
      </PublicSection>

      <PublicSection title="Tus datos y tu cuenta">
        <p>
          Cómo se manejan tus datos está en{' '}
          <a className="text-lion underline" href={PRIVACY_PATH}>
            Privacidad
          </a>
          . Puedes cerrar tu cuenta; los detalles están en{' '}
          <a className="text-lion underline" href={ACCOUNT_DELETION_PATH}>
            Eliminar cuenta
          </a>
          .
        </p>
      </PublicSection>

      <PublicSection title="Contacto">
        <p>
          <a
            className="text-lion underline"
            href={`mailto:${SELENE_SUPPORT_EMAIL}`}
          >
            {SELENE_SUPPORT_EMAIL}
          </a>
        </p>
      </PublicSection>
    </PublicPage>
  );
}
