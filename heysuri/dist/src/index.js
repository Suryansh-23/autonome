"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const middleware_sdk_1 = require("middleware-sdk");
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)();
const app = (0, express_1.default)();
const facilitatorURL = process.env.FACILITATOR_URL;
const payTo = process.env.ADDRESS;
console.log("FACILITATOR_URL:", facilitatorURL);
console.log("ADDRESS:", payTo);
if (!payTo || !facilitatorURL) {
    console.error("Missing ADDRESS or FACILITATOR_URL environment variables");
    process.exit(1);
}
app.use(express_1.default.json());
app.use((req, res, next) => (0, middleware_sdk_1.setHeaderMiddleware)(payTo, res, next));
app.use((0, middleware_sdk_1.middleware)(payTo, {
    '/*': { price: '$0.01', network: 'base-sepolia' }
}, {
    url: facilitatorURL
}, undefined, undefined));
// Serve static files from public directory
app.use(express_1.default.static(path_1.default.join(__dirname, '..', 'public')));
// Home route - serve the main index.html
app.get('/', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '..', 'components', 'index.html'));
});
// Notes route
app.get('/notes', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '..', 'components', 'notes', 'index.html'));
});
// Projects route
app.get('/projects', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '..', 'components', 'projects', 'index.html'));
});
// Work route
app.get('/work', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '..', 'components', 'work', 'index.html'));
});
// Hello route
app.get('/hello', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '..', 'components', 'hello', 'index.html'));
});
// Side quests route
app.get('/side-quests', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '..', 'components', 'side-quests', 'index.html'));
});
// About route (existing)
app.get('/about', function (req, res) {
    res.sendFile(path_1.default.join(__dirname, '..', 'components', 'about.htm'));
});
// 404 error handler - serve custom 404 page
app.get('*', (req, res) => {
    res.status(404).sendFile(path_1.default.join(__dirname, '..', 'components', '404.html'));
});
// Example API endpoint - JSON
app.get('/api-data', (req, res) => {
    res.json({
        message: 'Here is some sample API data',
        items: ['apple', 'banana', 'cherry'],
    });
});
// Health check
app.get('/healthz', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.listen(3001, () => {
    console.log('HeySuri server is running on http://localhost:3001');
});
module.exports = app;
//# sourceMappingURL=index.js.map