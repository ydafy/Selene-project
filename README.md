<div align="center">

# SELENE

### P2P Marketplace for Used PC Hardware

**A marketplace designed to make buying and selling used PC hardware safer, simpler, and more trustworthy.**

<img src="https://res.cloudinary.com/do9waay3o/image/upload/v1786334790/Cover_3_w0yvzp.png" alt="Selene — P2P Marketplace" width="900"/>

</div>

---

## What is Selene?

Selene is a P2P marketplace for buying and selling used PC hardware in Mexico.

The project was built from the ground up as a real product, combining a mobile marketplace with product verification, payments, shipping, seller workflows, and centralized administrative operations.

The goal is to create a safer and more trustworthy experience for second-hand hardware transactions.

---

## Core Marketplace Workflow

Selene is designed around three connected workflows: **buyer, seller, and marketplace operations**.

### Buyer

```text
Discover
   ↓
Product
   ↓
Purchase
   ↓
Seller Ships
   ↓
Delivery
   ↓
Buyer Confirms
   ↓
Release Request
```

### Seller

```text
Create Listing
   ↓
Published Immediately
   ↓
Verification Request
   ↓
Verified
   ↓
Available for Purchase
   ↓
Sale
   ↓
Ship
   ↓
Payout
```

> **Listing and verification are separate processes.** Sellers can publish their products immediately without verification. However, only verified products are eligible to be purchased through the marketplace.

### Marketplace Operations

```text
Order Created
      ↓
Payment Held
      ↓
Order Fulfillment
      ↓
Buyer Confirmation
      ↓
Release Request
      ↓
Admin Review
      ↓
Payment Released
```

The buyer's payment remains held while the order is fulfilled. Once the buyer confirms the order, Selene creates a release request that can be processed from the admin dashboard, allowing the seller's payment to be released.

---

## Core Features

### Buyer Experience

* 🔎 **Product Discovery** — Search, categories, filters, and product browsing
* 🛒 **Shopping & Checkout** — Cart, checkout, and purchase flows
* ❤️ **Favorites** — Save products and track potential purchases
* 📦 **Order Management** — Track orders, shipping, and delivery status

### Seller Experience

* 🏷️ **Product Listings** — Publish products instantly and manage listings
* 🔐 **Product Verification** — Submit products for verification before they become available for purchase

### Marketplace Operations

* 💳 **Escrow Payments** — Hold buyer payments until order completion
* ⚙️ **Admin Operations** — Manage verification, orders, payment releases, disputes, marketplace activity and users management

---

## Mobile App

### Designed around the complete marketplace experience

The mobile application brings together the main buyer and seller experiences, from discovering and evaluating products to purchasing, selling, verification, and order management.

### Screenshots

<div align="center">

<img src="https://res.cloudinary.com/do9waay3o/image/upload/v1786335795/Mockup_1_ess3eb.png" alt="Selene Home" width="320"/>
<img src="https://res.cloudinary.com/do9waay3o/image/upload/v1786335903/Mockup_17_n2wpjy.png" alt="Selene Search" width="320"/>
<img src="https://res.cloudinary.com/do9waay3o/image/upload/v1786335950/Mockup_18_lynhgd.png" alt="Selene Product" width="320"/>

<br/>

<img src="https://res.cloudinary.com/do9waay3o/image/upload/v1786335981/Mockup_3_y7sjml.png" alt="Selene Checkout" width="320"/>
<img src="https://res.cloudinary.com/do9waay3o/image/upload/v1786335990/Mockup_2_ore6vo.png" alt="Selene Orders" width="320"/>
<img src="https://res.cloudinary.com/do9waay3o/image/upload/v1786336188/Mockup_16_aeinur.png" alt="Selene Seller" width="320"/>

</div>

### Demo

#### Mobile Application

[▶ Watch the Selene mobile app demo](https://res.cloudinary.com/do9waay3o/video/upload/v1786336342/SeleneVideo_sydjcr.mp4)

#### Admin Dashboard

[▶ Watch the Selene admin dashboard demo](https://res.cloudinary.com/do9waay3o/video/upload/v1786336446/dashboard_w937qh.mp4)

---

## Technical Foundation

### Mobile

**React Native · Expo · TypeScript**

### Backend

**Supabase · PostgreSQL**

### Admin Dashboard

**React · Vite · TypeScript · Tailwind CSS**

### Services

**Stripe · Stripe Connect · Envia.com**

---

## Project Highlights

* **Multi-seller orders** — Support for carts containing products from different sellers
* **Product verification** — Separate listing and verification workflows
* **Escrow-based payments** — Buyer payments are held until order confirmation
* **Shipping operations** — Seller shipping and order fulfillment workflows
- **Payments** — Buyer payments processed through Stripe
- **Seller payouts** — Seller payouts handled through Stripe Connect after order completion
* **Dispute management** — Centralized handling of transaction disputes
* **Marketplace operations** — Administrative dashboard for managing the platform

---

## Development Status

Selene is in the final development and testing stage.

The core marketplace workflows are implemented. Current work is focused on refining the shipping and fulfillment flow, including shipping label generation and the Envia.com integration, followed by reviews and comments.

Testing is performed continuously throughout development, with the final stage focused mainly on real-device validation across iOS and Android and resolving remaining edge cases before production.
