### 1. "Link" de Stripe (El checkout de un solo toque en toda la red)

**¿Qué es?** Es la red de pago acelerado segura de Stripe.

- **Cómo funciona:** Si un usuario alguna vez compró algo en Rappi, Uber, o cualquier e-commerce grande usando Stripe y guardó su tarjeta en la red "Link", cuando entre por primera vez a Selene, Stripe detectará su número de teléfono. Le mandará un código SMS rápido y, en cuanto lo ingrese, **su tarjeta se auto-completará de forma segura en tu app móvil al instante**, sin que tenga que volver a escribir los 16 dígitos de su tarjeta en Selene.
- **Por qué es un must-have:** Aumenta la conversión de checkout en más del **7%** de forma gratuita. Está integrado de forma nativa en la SDK móvil de Stripe que ya usamos en tu app en Expo. Solo tenés que asegurarte de tenerlo encendido en tu Stripe Dashboard en la sección de métodos de pago.

---

### 2. Branding Coherente del Express Dashboard (Confianza ciega)

La mayoría de las startups novatas dejan el Express Dashboard de sus vendedores con la plantilla gris y genérica que Stripe trae por defecto. Esto se ve sumamente amateur y despierta desconfianza en el vendedor.

- **Cómo funciona:** En tu Stripe Dashboard (Configuración de Connect → Personalización de marca), podés subir tu logotipo de Selene, configurar tu color hexadecimal primario (`primary` de tu paleta cyberpunk), y configurar un link directo de soporte de Crisp.
- **Por qué es un must-have:** Cuando el vendedor entre a revisar sus depósitos y SPEIs en su celular, verá una pantalla hermosa, con tu logo, tus colores de Selene y un botón que dice _"¿Necesitás ayuda? Contactá al soporte de Selene"_. El usuario siente que **nunca salió de tu ecosistema**, aumentando la credibilidad de tu marca de forma gigante y gratuita.

---

### 3. SPEI Instantáneo (Instant Payouts - Feature Premium para ganar vendedores)

En México, los SPEIs automáticos normales de Stripe tardan de 24 a 48 horas hábiles en llegar al banco físico del vendedor.

- **Cómo funciona:** Stripe Connect Express permite habilitar las **transferencias instantáneas (Instant Payouts)** en México utilizando la red de pagos en tiempo real.
- **Por qué es un must-have:** Una vez que habilitas esta opción en tu dashboard, cuando una orden pase a `completed`, el vendedor honesto puede entrar a su Express Dashboard y hacer clic en _"Retirar al instante"_. El dinero le llegará a su tarjeta de débito de BBVA en **2 minutos** (usando SPEI en tiempo real).
- **El negocio:** Habilitar esto para Selene cuesta **$0 pesos**. El vendedor es quien asume de forma voluntaria la tarifa de Stripe por retiro instantáneo (suele ser el 1% o un costo fijo mínimo de $10 MXN). Esto te da una ventaja competitiva brutal frente a MercadoLibre o Facebook, porque tus vendedores honestos pueden cobrar de verdad de forma inmediata.

---

### 4. Reglas Personalizadas de Stripe Radar (Escudo anti-fraude)

Como vendés hardware de gama alta (el target preferido de los estafadores con tarjetas clonadas en México), tenés que explotar las **Reglas de Radar**.

- Podés crear reglas en tu panel sin tocar código que digan: _"Si el comprador intenta comprar un artículo de más de $5,000 pesos y el país emisor de su tarjeta no coincide con el país de su dirección IP, exigir obligatoriamente autenticación 3D Secure o bloquear el cargo inmediatamente"_. Esto te ahorra dolores de cabeza de contracargos antes de que ocurran.
