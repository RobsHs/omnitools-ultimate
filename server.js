const dns = require('dns').promises;
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));
app.listen(3000);

app.post('/api/network/dns', async (req, res) => res.json({ success: true }));
