# Payment Provider Integration

Ez a dokumentum leírja, hogyan működik a payment provider absztrakciós réteg, amely lehetővé teszi a Stripe és Barion közötti váltást.

## Áttekintés

A rendszer egy absztrakt `PaymentProvider` interface-t használ, amely lehetővé teszi, hogy különböző fizetési szolgáltatókat (Stripe, Barion) használjunk ugyanazzal a kóddal. A provider kiválasztása környezeti változókon keresztül történik.

## Konfiguráció

### Környezeti változók

#### Általános
- `PAYMENT_PROVIDER`: A használni kívánt provider (`stripe` vagy `barion`). Alapértelmezett: `stripe`

#### Stripe (kötelező, ha Stripe-ot használsz)
- `STRIPE_SECRET_KEY`: Stripe API secret key
- `STRIPE_WEBHOOK_SECRET`: Stripe webhook signature secret
- `STRIPE_SUCCESS_URL`: Redirect URL sikeres fizetés után
- `STRIPE_CANCEL_URL`: Redirect URL megszakított fizetés után

#### Barion (kötelező, ha Barion-t használsz)
- `BARION_POS_KEY`: Barion POS Key (API kulcs)
- `BARION_PAYEE`: Barion Payee (fizetési azonosító)
- `BARION_ENVIRONMENT`: Környezet (`sandbox` vagy `production`). Alapértelmezett: `sandbox`
- `BARION_SUCCESS_URL`: Redirect URL sikeres fizetés után (opcionális, Stripe URL-t használ, ha nincs megadva)
- `BARION_CALLBACK_URL`: Webhook URL a Barion callback-ekhez
- `BARION_CALLBACK_SECRET`: Secret a webhook signature ellenőrzéséhez

## Provider váltás

A provider váltása egyszerű: csak változtasd meg a `PAYMENT_PROVIDER` környezeti változót:

```bash
# Stripe használata
PAYMENT_PROVIDER=stripe

# Barion használata
PAYMENT_PROVIDER=barion
```

## Adatbázis migrációk

Az új Barion támogatáshoz szükséges adatbázis változások:

1. Futtasd a migráció generálást:
   ```bash
   bun run drizzle:generate
   ```

2. Alkalmazd a migrációkat:
   ```bash
   bun run drizzle:push
   ```

Az új táblák:
- `barion_customers`: Barion customer mapping
- `barion_events`: Barion webhook események naplózása

Az új mezők:
- `orders.barion_payment_id`: Barion payment ID
- `orders.barion_payment_request_id`: Barion payment request ID
- `orders.barion_customer_id`: Barion customer ID
- `payments.barion_payment_id`: Barion payment ID
- `payments.barion_transaction_id`: Barion transaction ID

## API Endpoints

### Checkout létrehozása
```
POST /payments/checkout/create
```

Ez automatikusan a konfigurált provider-t használja.

### Webhook endpoints

#### Stripe
```
POST /stripe/webhook
```

#### Barion
```
POST /barion/webhook
```

## Provider implementációk

### Stripe Provider
- Fájl: `backend/src/lib/payment-providers/stripe-provider.ts`
- A Stripe SDK-t használja
- HUF esetén speciális kezelés (Stripe SDK bug workaround)

### Barion Provider
- Fájl: `backend/src/lib/payment-providers/barion-provider.ts`
- REST API-t használ a Barion API-hoz
- HMAC SHA-256 signature verification

## Tesztelés

### Stripe
1. Állítsd be a Stripe sandbox környezeti változókat
2. Használd a Stripe test kártyákat

### Barion
1. Állítsd be a Barion sandbox környezeti változókat
2. Regisztrálj egy Barion sandbox fiókot: https://docs.barion.com/Sandbox
3. Szerezd meg a POS Key és Payee értékeket

## Hibakeresés

### Provider kiválasztás
A rendszer logolja, melyik provider-t használja:
```
[Checkout] Creating stripe checkout session for order: ...
[Checkout] Creating barion checkout session for order: ...
```

### Webhook hibák
A webhook események az adatbázisban vannak naplózva:
- `stripe_events` tábla Stripe eseményekhez
- `barion_events` tábla Barion eseményekhez

## További információk

- [Barion dokumentáció](https://docs.barion.com)
- [Stripe dokumentáció](https://stripe.com/docs)
