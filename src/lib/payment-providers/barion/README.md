# Barion Payment Provider - Refactored Implementation

## Áttekintés

Ez a modul a Barion fizetési szolgáltató integrációját tartalmazza, best practice-ek szerint refaktorálva.

## Struktúra

```
barion/
├── index.ts          # Module exports
├── constants.ts      # API endpoints, statuses, minimum amounts
├── types.ts          # TypeScript típusok a Barion API-hoz
├── api-client.ts     # HTTP kliens a Barion API-val való kommunikációhoz
├── validators.ts     # URL és konfiguráció validátorok
└── README.md         # Ez a dokumentáció
```

## Főbb jellemzők

### 1. Separated Concerns
- **API Client**: Minden HTTP kommunikáció egy helyen
- **Validators**: URL és konfiguráció validáció
- **Constants**: Magic stringek és számok kiemelése
- **Types**: Típusbiztonság a teljes modulban

### 2. Error Handling
- Strukturált hibakezelés `BarionApiError` típussal
- Részletes hibaüzenetek a debugoláshoz
- Barion API hibák megfelelő kezelése

### 3. Type Safety
- Minden API request/response típusokkal definiálva
- TypeScript strict mode kompatibilis
- Nincs `any` típus használat

### 4. Logging
- Strukturált logolás konzisztens formátumban
- Debug információk csak development módban
- Érzékeny adatok (POSKey) nem logolódnak

### 5. Validation
- URL validáció (HTTPS, nem localhost)
- Összeg validáció (minimum összegek)
- Konfiguráció validáció (kötelező változók)

## Használat

```typescript
import { BarionProvider } from "../barion-provider";

const provider = new BarionProvider();

// Checkout session létrehozása
const session = await provider.createCheckoutSession({
  orderId: "order-123",
  userId: "user-456",
  planName: "200 Mesetallér",
  planCode: "pack_200",
  totalCents: 2990,
  currency: "HUF",
  creditsTotal: 200,
  customerEmail: "user@example.com",
});

// Payment state lekérdezése
const state = await provider.getPaymentState(session.id);
```

## API Endpoints

A Barion API dokumentációja: https://docs.barion.com/List_of_API_endpoints

### Használt endpointok:
- `POST /v2/Payment/Start` - Fizetés indítása
- `GET /v2/Payment/GetPaymentState` - Fizetés állapot lekérdezése

## Konfiguráció

Kötelező környezeti változók:
- `BARION_POS_KEY` - Barion POS Key
- `BARION_PAYEE` - Barion Payee (fizetési azonosító)
- `BARION_SUCCESS_URL` - HTTPS URL sikeres fizetés után
- `BARION_CALLBACK_URL` - HTTPS URL webhook-okhoz
- `BARION_CALLBACK_SECRET` - Secret webhook signature ellenőrzéséhez
- `BARION_ENVIRONMENT` - `sandbox` vagy `production`

## Hibakezelés

A `BarionApiError` tartalmazza:
- `statusCode`: HTTP státusz kód
- `errors`: Barion API hibák tömbje
- `responseBody`: Teljes response body (debugoláshoz)

## Tesztelés

Sandbox környezet használata:
```bash
BARION_ENVIRONMENT=sandbox
BARION_POS_KEY=your_sandbox_pos_key
BARION_PAYEE=your_sandbox_payee
```

## További információk

- [Barion dokumentáció](https://docs.barion.com)
- [Barion API endpoints](https://docs.barion.com/List_of_API_endpoints)
- [Barion Sandbox](https://docs.barion.com/Sandbox)
