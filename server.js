const express = require('express');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');
const { getRolesList, getGuildsList, toggleGuildMonitoring } = require('./bot');

const app = express();
app.use(express.json());

// ตั้งค่า Swagger
const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Discord Bot Roles API',
            version: '1.0.0',
            description: 'API สำหรับจัดการและติดตาม Roles ของ Discord Server พร้อม Webhook จำลอง',
        },
        servers: [
            {
                url: `http://localhost:${process.env.PORT || 3000}`,
                description: 'Local development server',
            },
        ],
    },
    apis: ['./server.js'], // ค้นหา JSDoc ในไฟล์นี้
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

/**
 * @openapi
 * /api/roles:
 *   get:
 *     summary: ดูรายชื่อ Role ทั้งหมดจากเซิร์ฟเวอร์
 *     description: คืนค่ารายการ Roles ของบอททุกเซิร์ฟเวอร์ที่บอทเข้าร่วมอยู่
 *     responses:
 *       200:
 *         description: ดึงข้อมูลสำเร็จ
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 roles:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       guildId:
 *                         type: string
 *                         example: "1443046650346999870"
 *                       guildName:
 *                         type: string
 *                         example: "Arnater0-Club"
 *                       id:
 *                         type: string
 *                         example: "1508676363215700122"
 *                       name:
 *                         type: string
 *                         example: "Admin"
 *                       color:
 *                         type: string
 *                         example: "#ff0000"
 *                       position:
 *                         type: integer
 *                         example: 3
 *                       permissions:
 *                         type: string
 *                         example: "8"
 */
app.get('/api/roles', async (req, res) => {
    const roles = await getRolesList();
    res.json({
        success: true,
        roles: roles
    });
});

// API ดึงรายชื่อ Guild (เซิร์ฟเวอร์) ทั้งหมดที่บอทเข้าร่วมอยู่
app.get('/api/guilds', async (req, res) => {
    const guilds = await getGuildsList();
    res.json({ success: true, guilds });
});

// API เปิด/ปิดการ Monitor ของ Guild
app.post('/api/guilds/:id/toggle', (req, res) => {
    const result = toggleGuildMonitoring(req.params.id);
    res.json({ success: true, ...result });
});

// หน้า Dashboard แสดงรายชื่อ Server
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

let latestWebhook = null;
let clients = [];

// API Endpoint สำหรับรับ SSE (Server-Sent Events) เชื่อมต่อแบบ Real-time
app.get('/api/webhook/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // ส่งข้อมูลล่าสุดให้ทันทีถ้ามี
    if (latestWebhook) {
        res.write(`data: ${JSON.stringify(latestWebhook)}\n\n`);
    }
    
    clients.push(res);
    
    req.on('close', () => {
        clients = clients.filter(c => c !== res);
    });
});

/**
 * @openapi
 * /api/webhook/local:
 *   post:
 *     summary: รับ Webhook ทดสอบภายในเครื่อง (Local Webhook Receiver)
 *     description: จุดเชื่อมต่อสำหรับทดสอบการรับ Webhook จากตัวบอทเองโดยไม่ต้องใช้ Webhook ภายนอก
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               event:
 *                 type: string
 *                 example: "role_created"
 *               timestamp:
 *                 type: string
 *                 example: "2026-05-26T04:00:00.000Z"
 *               details:
 *                 type: object
 *               roles:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       200:
 *         description: รับข้อมูล Webhook เรียบร้อย
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Webhook received locally"
 */
app.post('/api/webhook/local', (req, res) => {
    // บันทึกเฉพาะข้อมูลล่าสุดตัวเดียว
    latestWebhook = {
        receivedAt: new Date().toISOString(),
        ...req.body
    };

    // ส่งสัญญาณ Real-time ไปให้ทุกบราวเซอร์ที่เปิดหน้าเว็บอยู่
    clients.forEach(client => client.write(`data: ${JSON.stringify(latestWebhook)}\n\n`));

    res.json({
        success: true,
        message: 'Webhook received locally'
    });
});

/**
 * @openapi
 * /api/webhook/local:
 *   get:
 *     summary: ดู Webhook ตัวล่าสุดที่มีการอัปเดตเข้ามา
 *     description: คืนค่าเฉพาะรายการ Webhook ล่าสุดที่มีการอัปเดตเข้ามาเพียงรายการเดียวเท่านั้น
 *     responses:
 *       200:
 *         description: สำเร็จ
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
app.get('/api/webhook/local', (req, res) => {
    // หากเข้าใช้งานผ่าน Web Browser ปกติ (รับส่งค่าเป็น HTML)
    if (req.headers.accept && req.headers.accept.includes('text/html')) {
        return res.sendFile(path.join(__dirname, 'public', 'monitor.html'));
    }

    if (!latestWebhook) {
        return res.json({
            success: true,
            message: "ยังไม่มีการอัปเดต Webhook ส่งเข้ามาในระบบ"
        });
    }
    res.json(latestWebhook);
});

// ฟังก์ชันเริ่มการทำงานของ Express Server
function startServer() {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on port ${PORT}`);
    });
}

module.exports = {
    startServer
};
