// server.js — Angeli's Catering Payment Backend
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { APIContracts, APIControllers, Constants } = require('authorizenet');

const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ─── Serve static files (catering form, etc.) ──────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3001;
const API_LOGIN_ID = process.env.AUTHORIZENET_API_LOGIN_ID;
const TRANSACTION_KEY = process.env.AUTHORIZENET_TRANSACTION_KEY;

// ─── Health Check ──────────────────────────────────────────────────────────────
// Version: 2026-04-03-fix
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: "Angeli's Payment API" });
});

// ─── Charge Card ───────────────────────────────────────────────────────────────
app.post('/charge', async (req, res) => {
  const {
    cardNumber,
    cardExpiry,   // "MM/YY"
    cardCVV,
    amount,
    firstName,
    lastName,
    email,
    orderDescription,
  } = req.body;

  // Basic validation
  if (!cardNumber || !cardExpiry || !cardCVV || !amount) {
    return res.status(400).json({ success: false, error: 'Missing required payment fields' });
  }
  if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid amount' });
  }

  const [expMonth, expYear] = cardExpiry.split('/').map(s => s.trim());
  const expirationDate = `20${expYear}-${expMonth.padStart(2, '0')}`;

  // ── Build Authorize.net request ───────────────────────────────────────────────
  const merchantAuthenticationType = new APIContracts.MerchantAuthenticationType();
  merchantAuthenticationType.setName(API_LOGIN_ID);
  merchantAuthenticationType.setTransactionKey(TRANSACTION_KEY);

  const creditCard = new APIContracts.CreditCardType();
  creditCard.setCardNumber(cardNumber.replace(/\s/g, ''));
  creditCard.setExpirationDate(expirationDate);
  creditCard.setCardCode(cardCVV);

  const paymentType = new APIContracts.PaymentType();
  paymentType.setCreditCard(creditCard);

  const orderType = new APIContracts.OrderType();
  orderType.setDescription(orderDescription || "Angeli's Catering Order");

  const transactionRequest = new APIContracts.TransactionRequestType();
  transactionRequest.setTransactionType(
    APIContracts.TransactionTypeEnum.AUTHCAPTURETRANSACTION
  );
  transactionRequest.setPayment(paymentType);
  transactionRequest.setAmount(parseFloat(amount).toFixed(2));
  transactionRequest.setOrder(orderType);

  if (firstName || lastName || email) {
    const billTo = new APIContracts.CustomerAddressType();
    if (firstName) billTo.setFirstName(firstName);
    if (lastName)  billTo.setLastName(lastName);
    if (email)     billTo.setEmail(email);
    transactionRequest.setBillTo(billTo);
  }

  const createRequest = new APIContracts.CreateTransactionRequest();
  createRequest.setMerchantAuthentication(merchantAuthenticationType);
  createRequest.setTransactionRequest(transactionRequest);

  // ── Execute ────────────────────────────────────────────────────────────────────
  const ctrl = new APIControllers.CreateTransactionController(createRequest.getJSON());
  ctrl.setEnvironment(Constants.endpoint.production);

  try {
    ctrl.execute(() => {
      try {
        const apiResponse = ctrl.getResponse();
        console.log('Raw API response:', JSON.stringify(apiResponse));

        if (!apiResponse) {
          return res.status(500).json({ success: false, error: 'No response from payment processor.' });
        }

        const response = new APIContracts.CreateTransactionResponse(apiResponse);
        const txn = response.getTransactionResponse ? response.getTransactionResponse() : null;

        // Success check
        const txnId = txn && txn.getTransId ? txn.getTransId() : null;
        const txnResponseCode = txn && txn.getResponseCode ? txn.getResponseCode() : null;
        if (txnId && txnId !== '0' && txnResponseCode === '1') {
          return res.json({
            success: true,
            transactionId: txnId,
            authCode: txn.getAuthCode ? txn.getAuthCode() : '',
            message: 'Payment approved',
          });
        }

        // Error handling
        let errorMsg = 'Payment declined. Please check your card details and try again.';
        try {
          if (txn && txn.getErrors && txn.getErrors()) {
            errorMsg = txn.getErrors().getError()[0].getErrorText();
          } else if (response.getMessages && response.getMessages()) {
            errorMsg = response.getMessages().getMessage()[0].getText();
          }
        } catch (_) {}

        return res.status(402).json({ success: false, error: errorMsg });
      } catch (innerErr) {
        console.error('Authorize.net callback error:', JSON.stringify(innerErr, Object.getOwnPropertyNames(innerErr)));
        if (!res.headersSent) {
          return res.status(500).json({ success: false, error: 'Payment processing error.', detail: innerErr.message });
        }
      }
    });
  } catch (outerErr) {
    console.error('Authorize.net execute error:', JSON.stringify(outerErr, Object.getOwnPropertyNames(outerErr)));
    return res.status(500).json({ success: false, error: 'Payment processing error.', detail: outerErr.message });
  }
});

// ─── Charge via Apple Pay (Authorize.net opaque data) ─────────────────────────
app.post('/charge-applepay', async (req, res) => {
  const { opaqueDataDescriptor, opaqueDataValue, amount, firstName, lastName, email, orderDescription } = req.body;

  if (!opaqueDataDescriptor || !opaqueDataValue || !amount) {
    return res.status(400).json({ success: false, error: 'Missing required Apple Pay fields' });
  }
  if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid amount' });
  }

  const merchantAuthenticationType = new APIContracts.MerchantAuthenticationType();
  merchantAuthenticationType.setName(API_LOGIN_ID);
  merchantAuthenticationType.setTransactionKey(TRANSACTION_KEY);

  const opaqueData = new APIContracts.OpaqueDataType();
  opaqueData.setDataDescriptor(opaqueDataDescriptor);
  opaqueData.setDataValue(opaqueDataValue);

  const paymentType = new APIContracts.PaymentType();
  paymentType.setOpaqueData(opaqueData);

  const orderType = new APIContracts.OrderType();
  orderType.setDescription(orderDescription || "Angeli's Catering Order");

  const transactionRequest = new APIContracts.TransactionRequestType();
  transactionRequest.setTransactionType(APIContracts.TransactionTypeEnum.AUTHCAPTURETRANSACTION);
  transactionRequest.setPayment(paymentType);
  transactionRequest.setAmount(parseFloat(amount).toFixed(2));
  transactionRequest.setOrder(orderType);

  if (firstName || lastName || email) {
    const billTo = new APIContracts.CustomerAddressType();
    if (firstName) billTo.setFirstName(firstName);
    if (lastName)  billTo.setLastName(lastName);
    if (email)     billTo.setEmail(email);
    transactionRequest.setBillTo(billTo);
  }

  const createRequest = new APIContracts.CreateTransactionRequest();
  createRequest.setMerchantAuthentication(merchantAuthenticationType);
  createRequest.setTransactionRequest(transactionRequest);

  const ctrl = new APIControllers.CreateTransactionController(createRequest.getJSON());
  ctrl.setEnvironment(Constants.endpoint.production);

  try {
    ctrl.execute(() => {
      try {
        const apiResponse = ctrl.getResponse();
        if (!apiResponse) {
          return res.status(500).json({ success: false, error: 'No response from payment processor.' });
        }
        const response = new APIContracts.CreateTransactionResponse(apiResponse);
        const txn = response.getTransactionResponse ? response.getTransactionResponse() : null;

        const transId = txn && txn.getTransId ? txn.getTransId() : null;
        const responseCode = txn && txn.getResponseCode ? txn.getResponseCode() : null;
        if (transId && transId !== '0' && responseCode === '1') {
          return res.json({
            success: true,
            transactionId: transId,
            authCode: txn.getAuthCode ? txn.getAuthCode() : '',
            message: 'Apple Pay payment approved',
          });
        }

        let errorMsg = 'Payment declined.';
        try {
          if (txn && txn.getErrors && txn.getErrors()) {
            errorMsg = txn.getErrors().getError()[0].getErrorText();
          } else if (response.getMessages && response.getMessages()) {
            errorMsg = response.getMessages().getMessage()[0].getText();
          }
        } catch (_) {}

        return res.status(402).json({ success: false, error: errorMsg });
      } catch (innerErr) {
        console.error('Apple Pay callback error:', innerErr.message);
        if (!res.headersSent) {
          return res.status(500).json({ success: false, error: 'Payment processing error.', detail: innerErr.message });
        }
      }
    });
  } catch (outerErr) {
    console.error('Apple Pay execute error:', outerErr.message);
    return res.status(500).json({ success: false, error: 'Payment processing error.', detail: outerErr.message });
  }
});

// ─── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Angeli's payment server running on port ${PORT}`);
});
