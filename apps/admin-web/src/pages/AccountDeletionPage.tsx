import { SELENE_SUPPORT_EMAIL } from '@selene/types';
import { PublicPage, PublicSection } from '../components/public/PublicPage';

export function AccountDeletionPage() {
  return (
    <PublicPage title="Eliminar tu cuenta de Selene">
      <PublicSection title="Desde la app">
        <p>
          Abre Selene y ve a Perfil &gt; Ajustes &gt; Privacidad &gt; Eliminar cuenta. Por seguridad
          te pediremos iniciar sesión de nuevo (inicio de sesión reciente) antes de confirmar.
        </p>
      </PublicSection>

      <PublicSection title="Sin la app">
        <p>
          Escribe a{' '}
          <a className="text-lion underline" href={`mailto:${SELENE_SUPPORT_EMAIL}`}>
            {SELENE_SUPPORT_EMAIL}
          </a>{' '}
          con el asunto &quot;Eliminar mi cuenta&quot;, desde el correo con el que te registraste, e
          indica ese correo en el mensaje.
        </p>
      </PublicSection>

      <PublicSection title="Qué se elimina de inmediato">
        <ul className="list-disc space-y-1 pl-5">
          <li>Correo electrónico y teléfono</li>
          <li>Direcciones</li>
          <li>Foto de perfil</li>
          <li>Tarjetas guardadas</li>
          <li>Favoritos y bloqueos</li>
          <li>Notificaciones</li>
          <li>Publicaciones sin vender</li>
        </ul>
      </PublicSection>

      <PublicSection title="Qué se conserva">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Tu perfil público y tus reseñas permanecen como &quot;Usuario eliminado&quot;.
          </li>
          <li>
            Pedidos, envíos, pagos y disputas se conservan bloqueados durante 5 años (Código Fiscal,
            art. 30). Solo se consultan para reclamaciones, disputas o requerimientos fiscales y
            después se anonimizan.
          </li>
        </ul>
      </PublicSection>

      <PublicSection title="Cuándo no se puede eliminar">
        <p>
          No podemos eliminar la cuenta mientras haya un envío, pedido, disputa, reembolso o pago
          sin liberar pendiente. No se cambia nada hasta que se resuelva.
        </p>
      </PublicSection>

      <PublicSection title="Volver a registrarte">
        <p>El mismo correo puede registrarse de nuevo como una cuenta nueva.</p>
      </PublicSection>
    </PublicPage>
  );
}
