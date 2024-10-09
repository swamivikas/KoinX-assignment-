const express = require('express');
const axios = require('axios');
const { Client } = require('pg');
const cron = require('node-cron');

const app = express();
app.use(express.json());


const client = new Client({
  user: 'postgres', 
  host: 'localhost',
  database: 'crypto_db',  
  password: 'enter you pg password',  // replace with your PostgreSQL password
  port: 5432,  
});
client.connect()
  .then(() => console.log('Connected to PostgreSQL'))
  .catch(err => console.error('Connection error', err.stack));

// Create table for storing cryptocurrency data if not exists
const createTableQuery = `
  CREATE TABLE IF NOT EXISTS crypto_data (
    id SERIAL PRIMARY KEY,
    coin_id VARCHAR(50),
    price DECIMAL,
    market_cap DECIMAL,
    change24h DECIMAL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;
client.query(createTableQuery)
  .then(() => console.log('Table is ready'))
  .catch(err => console.error('Error creating table', err.stack));

// Fetch cryptocurrency data from CoinGecko and store in PostgreSQL
const fetchCryptoData = async () => {
  try {
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price', {
        params: {
          ids: 'bitcoin,ethereum,matic-network',
          vs_currencies: 'usd',
          include_market_cap: 'true',
          include_24hr_change: 'true'
        }
      }
    );

    const data = response.data;
    const coins = ['bitcoin', 'ethereum', 'matic-network'];

    for (const coin of coins) {
      const price = data[coin].usd;
      const marketCap = data[coin].usd_market_cap;
      const change24h = data[coin].usd_24h_change;

      // Insert data into PostgreSQL
      await client.query(
        'INSERT INTO crypto_data (coin_id, price, market_cap, change24h) VALUES ($1, $2, $3, $4)',
        [coin, price, marketCap, change24h]
      );
    }

    console.log('Cryptocurrency data saved!');
  } catch (err) {
    console.error('Error fetching data from CoinGecko:', err.message);
  }
};

// Schedule the job to run every 2 hours
cron.schedule('0 */2 * * *', fetchCryptoData);

// Fetch latest stats for a coin
app.get('/api/stats', async (req, res) => {
  const { coin } = req.query;

  if (!coin) {
    return res.status(400).json({ message: 'Coin parameter is required' });
  }

  try {
    const query = 'SELECT price, market_cap, change24h FROM crypto_data WHERE coin_id = $1 ORDER BY timestamp DESC LIMIT 1';
    const result = await client.query(query, [coin]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No data found for the coin' });
    }

    const { price, market_cap, change24h } = result.rows[0];
    res.json({ price, marketCap: market_cap, '24hChange': change24h });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching data' });
  }
});

// Calculate standard deviation for the last 100 records
app.get('/api/deviation', async (req, res) => {
  const { coin } = req.query;

  if (!coin) {
    return res.status(400).json({ message: 'Coin parameter is required' });
  }

  try {
    const query = 'SELECT price FROM crypto_data WHERE coin_id = $1 ORDER BY timestamp DESC LIMIT 100';
    const result = await client.query(query, [coin]);

    if (result.rows.length < 2) {
      return res.status(400).json({ message: 'Not enough records to calculate deviation' });
    }

    const prices = result.rows.map(row => parseFloat(row.price));
    const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    const variance = prices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / prices.length;
    const stdDeviation = Math.sqrt(variance);

    res.json({ deviation: stdDeviation.toFixed(2) });
  } catch (err) {
    res.status(500).json({ message: 'Error calculating deviation' });
  }
});

// Run the fetchCryptoData immediately on server start
fetchCryptoData();

// Start the server
const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
