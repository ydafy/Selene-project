# Seller onboarding guide (#551)

Roadmap #548, item 3. Rewrite the in-app Stripe Connect onboarding guide (`apps/frontend/src/app/sell/onboarding.tsx`) for the questions Stripe still asks after the #550 prefill.
Branch `feat/seller-onboarding-guide` from `origin/main`, worktree `bruno-money-functions`. The maintainer checks the result before the feature is closed (L4).

## Specs

- S1 (issue #551): "three cards with one direct line each and the key word in bold (CLABE, INE, phone for the SMS code)".
- S2 (issue #551): "exact choices where Stripe still asks something". After #550 Stripe asks no multiple-choice question (name, bank and terms first; then address and date of birth), so the guide names no choice.
- S3 (issue #551): "one time estimate everywhere". Both the guide and the prepare-shipment notice (`orders.json` `connectBody`) say "unos 5 minutos" / "about 5 minutes".
- S4 (issue #551): "no sandbox screenshots".
- S5 (issue #551): "copy for the expired-link return". A `?refresh=1` return shows its own notice ("El enlace de Stripe venció") and the "Continuar en Stripe" button, unless Stripe rejected the account.
- S6 (issue #551): "a shorter success screen". Title, one line, the CTA, and the payout explanation behind a "¿Cómo funcionan los pagos?" expander.
- S7 (maintainer, L3): one screen instead of the four-step wizard (no "Perfil" and "Datos" steps, no Back/Next); the INE card asks the seller to copy their data as it appears on the INE, not to upload it. Copy as proposed in L2.

## Tasks

- [ ] T1 (S5, S7): `connect-onboarding-ui.ts` resolves a single guide screen with a status notice (`pending`, `rejected`, `expired`) and the CTA key. Test first. Route: inline. Commit: pending.
- [ ] T2 (S1-S4, S6, S7): screen, components and es/en copy; remove the sandbox screenshots; same time estimate in `orders.json`; locale tests. Route: inline. Commit: pending.

## Log

- L1 (maintainer, 2026-11-16): "Continuá con #551 (roadmap #548) en el worktree bruno-money-functions, en la rama feat/seller-onboarding-guide que ya está creada desde origin/main (tiene un commit de docs que cierra #550 y sale con este PR; el stack local está apagado). [...] Lo que Stripe le sigue pidiendo al vendedor está en el comentario de #550 (nombre, banco y términos primero; después domicilio y fecha de nacimiento). Ya no pregunta tipo de negocio ni sitio web. [...] Sigue el idioma del celular [...], así que la guía no tiene que explicar cómo cambiar el idioma. En el panel de Stripe del vendedor dice "Selene" a propósito (el nombre por vendedor es la Idea #635). [...] Antes de escribir código, proponeme el contenido de la guía (pasos y textos) y esperá mi OK."
- L2 (2026-11-16): sandbox account `acct_1UcJMeACloJvncJ6` (prefill, completed) has empty `requirements` and `future_requirements` and `payouts_enabled: true`; no identity document was requested. Proposed copy: header "Activa tus cobros" / "Para depositarte tus ventas, Stripe (quien procesa los pagos en Selene) necesita verificar quién eres. Es gratis y toma unos 5 minutos."; cards "Ten tu celular a la mano. Stripe te manda un código por SMS para crear tu cuenta.", "Ten tu INE a la mano. Escribe tu nombre, fecha de nacimiento y domicilio tal como aparecen en tu INE.", "Ten tu CLABE a la mano. Stripe deposita tus ventas en tu banco con tu CLABE de 18 dígitos."; note "Al final aceptas los términos de Stripe y regresas solo a Selene."; notices pending "Te faltan unos datos en Stripe", rejected "Stripe necesita que corrijas algo", expired "El enlace de Stripe venció"; success "Listo, ya puedes vender" / "Stripe ya puede depositarte. Ya puedes imprimir tus guías de envío." with a "¿Cómo funcionan los pagos?" expander.
- L3 (maintainer, 2026-11-16): "me gusta master me gusta, tu hazlo, soy de los que les gusta ver primero y luego mejkoarrlo despues, pero primero ocupo ver algo, asi que haz lo que tu recomiendas, que ojo, suena bien y me gusta, solo aclaro que cunado acabes me dejs cehcarlo y analizarlo antes de darlo por cerrado."
- L4 (2026-11-16): the feature stays open until the maintainer reviews it on a device.
