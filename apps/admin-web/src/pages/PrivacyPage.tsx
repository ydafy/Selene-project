import { ACCOUNT_DELETION_PATH, SELENE_SUPPORT_EMAIL } from '@selene/types';
import { PublicPage, PublicSection } from '../components/public/PublicPage';

export function PrivacyPage() {
  return (
    <PublicPage title="Privacidad en Selene">
      <p
        role="note"
        className="rounded-lg bg-fire/10 p-3 text-sm text-fire border border-fire/20"
      >
        Este es un resumen de cómo se manejan los datos. El aviso de privacidad completo está
        pendiente de revisión legal y no debe presentarse como definitivo.
      </p>

      <PublicSection title="Datos de tu cuenta">
        <p>
          Usamos tu correo, teléfono, direcciones, foto de perfil, favoritos y bloqueos para operar
          tu cuenta, tus compras y tus ventas.
        </p>
      </PublicSection>

      <PublicSection title="Pagos">
        <p>Los pagos y las tarjetas guardadas se procesan a través de Stripe.</p>
      </PublicSection>

      <PublicSection title="Envíos">
        <p>Los envíos se gestionan a través de Envia, que recibe los datos necesarios para entregar.</p>
      </PublicSection>

      <PublicSection title="Eliminación y conservación">
        <p>
          Puedes eliminar tu cuenta; los detalles están en{' '}
          <a className="text-lion underline" href={ACCOUNT_DELETION_PATH}>
            Eliminar cuenta
          </a>
          . Pedidos, envíos, pagos y disputas se conservan bloqueados durante 5 años (Código Fiscal,
          art. 30) y después se anonimizan.
        </p>
      </PublicSection>

      <PublicSection title="Contacto">
        <p>
          <a className="text-lion underline" href={`mailto:${SELENE_SUPPORT_EMAIL}`}>
            {SELENE_SUPPORT_EMAIL}
          </a>
        </p>
      </PublicSection>
    </PublicPage>
  );
}
