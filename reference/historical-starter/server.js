const express = require('express');
const agentHandler = require('./middleware/agent-handler');

const app = express();
const PORT = 3000;

app.use(agentHandler);

app.get('/', (req, res) => {
  res.send('Agent-Aware Architecture server is running! Check out /.well-known/llms.txt');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
