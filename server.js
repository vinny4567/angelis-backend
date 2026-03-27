// server.js — Angeli's Catering Payment Backend
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { APIContracts, APIControllers, Constants } = require('authorizenet');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const API_LOGIN_ID = process.env.AUTHORIZENET_API_LOGIN_ID;
const TRANSACTION_KEY = process.env.AUTHORIZENET_TRANSACTION_KEY;

// ─── Health Check ──────────────────────────────────────────────────────────────
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
  ctrl.setEnvironment(Constants.endpoint.production); // use sandbox for testing
  // ctrl.setEnvironment(Constants.endpoint.sandbox); // ← uncomment to test

  ctrl.execute(() => {
    const apiResponse = ctrl.getResponse();
    const response = new APIContracts.CreateTransactionResponse(apiResponse);

    if (
      response !== null &&
      response.getMessages().getResultCode() === APIContracts.MessageTypeEnum.OK &&
      response.getTransactionResponse() !== null &&
      response.getTransactionResponse().getMessages() !== null
    ) {
      const txn = response.getTransactionResponse();
      return res.json({
        success: true,
        transactionId: txn.getTransId(),
        authCode: txn.getAuthCode(),
        message: txn.getMessages().getMessage()[0].getDescription(),
      });
    }

    // Handle errors
    let errorMsg = 'Payment failed';
    if (
      response !== null &&
      response.getTransactionResponse() !== null &&
      response.getTransactionResponse().getErrors() !== null
    ) {
      errorMsg = response
        .getTransactionResponse()
        .getErrors()
        .getError()[0]
        .getErrorText();
    } else if (response !== null) {
      errorMsg = response.getMessages().getMessage()[0].getText();
    }

    return res.status(402).json({ success: false, error: errorMsg });
  });
});

// ─── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Angeli's payment server running on port ${PORT}`);
});
