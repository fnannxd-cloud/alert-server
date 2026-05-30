// ============================================================
//  Alert Server - سيرفر التنبيهات
//  يشتغل على Render.com مجاناً وممكن تربطه بأي مشروع
// ============================================================

const express = require('express');
const cors = require('cors');
const app = express();

// السماح لأي موقع يتواصل مع السيرفر
app.use(cors());
app.use(express.json());

// ============================================================
//  الإعدادات - بتتحط كـ Environment Variables على Render
// ============================================================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// ============================================================
//  تخزين التنبيهات في الذاكرة
// ============================================================
let alerts = [];

// ============================================================
//  الصفحة الرئيسية - للتأكد إن السيرفر شغال
// ============================================================
app.get('/', (req, res) => {
    res.json({
        status: '✅ Server is running!',
        alertsCount: alerts.length,
        activeAlerts: alerts.filter(a => !a.triggered).length,
        uptime: Math.floor(process.uptime()) + ' seconds'
    });
});

// ============================================================
//  إضافة تنبيه جديد
//  POST /api/alerts
//  Body: { coin, targetPrice, direction, projectName }
// ============================================================
app.post('/api/alerts', (req, res) => {
    const { coin, targetPrice, direction, projectName } = req.body;

    if (!coin || !targetPrice || !direction) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: coin, targetPrice, direction'
        });
    }

    const alert = {
        id: Date.now().toString(),
        coin: coin.toUpperCase(),
        targetPrice: parseFloat(targetPrice),
        direction: direction, // 'above' = لما السعر يعلى فوق | 'below' = لما السعر ينزل تحت
        projectName: projectName || 'Unknown Project',
        createdAt: new Date().toISOString(),
        triggered: false
    };

    alerts.push(alert);
    console.log(`✅ New alert added: ${alert.coin} ${alert.direction} $${alert.targetPrice}`);

    res.json({ success: true, alert });
});

// ============================================================
//  عرض كل التنبيهات
//  GET /api/alerts
// ============================================================
app.get('/api/alerts', (req, res) => {
    res.json({
        success: true,
        total: alerts.length,
        active: alerts.filter(a => !a.triggered).length,
        alerts: alerts
    });
});

// ============================================================
//  حذف تنبيه معين
//  DELETE /api/alerts/:id
// ============================================================
app.delete('/api/alerts/:id', (req, res) => {
    const before = alerts.length;
    alerts = alerts.filter(a => a.id !== req.params.id);

    if (alerts.length < before) {
        res.json({ success: true, message: 'Alert deleted' });
    } else {
        res.status(404).json({ success: false, error: 'Alert not found' });
    }
});

// ============================================================
//  حذف كل التنبيهات
//  DELETE /api/alerts
// ============================================================
app.delete('/api/alerts', (req, res) => {
    alerts = [];
    res.json({ success: true, message: 'All alerts cleared' });
});

// ============================================================
//  إرسال رسالة تيليجرام
// ============================================================
async function sendTelegram(message) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.error('❌ Telegram not configured! Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID');
        return false;
    }

    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'HTML'
            })
        });

        const data = await response.json();
        if (data.ok) {
            console.log('📨 Telegram message sent successfully!');
            return true;
        } else {
            console.error('❌ Telegram error:', data.description);
            return false;
        }
    } catch (error) {
        console.error('❌ Failed to send Telegram:', error.message);
        return false;
    }
}

// ============================================================
//  فحص الأسعار كل 30 ثانية
// ============================================================
async function checkPrices() {
    const activeAlerts = alerts.filter(a => !a.triggered);
    if (activeAlerts.length === 0) return;

    try {
        // جلب أسعار كل العملات من Binance
        const response = await fetch('https://api.binance.com/api/v3/ticker/price');
        const prices = await response.json();

        // تحويل لـ Map للبحث السريع
        const priceMap = {};
        prices.forEach(p => {
            priceMap[p.symbol] = parseFloat(p.price);
        });

        // فحص كل تنبيه
        for (const alert of activeAlerts) {
            const symbol = alert.coin + 'USDT';
            const currentPrice = priceMap[symbol];

            if (!currentPrice) continue;

            let shouldTrigger = false;

            if (alert.direction === 'above' && currentPrice >= alert.targetPrice) {
                shouldTrigger = true;
            } else if (alert.direction === 'below' && currentPrice <= alert.targetPrice) {
                shouldTrigger = true;
            }

            if (shouldTrigger) {
                alert.triggered = true;
                alert.triggeredAt = new Date().toISOString();
                alert.triggeredPrice = currentPrice;

                const emoji = alert.direction === 'above' ? '🟢📈' : '🔴📉';
                const dirText = alert.direction === 'above' ? 'وصل فوق' : 'نزل تحت';

                const message =
                    `${emoji} <b>تنبيه سعر!</b>\n\n` +
                    `💰 العملة: <b>${alert.coin}</b>\n` +
                    `🎯 السعر المستهدف: <b>$${alert.targetPrice}</b>\n` +
                    `💵 السعر الحالي: <b>$${currentPrice}</b>\n` +
                    `📊 الاتجاه: <b>${dirText}</b>\n` +
                    `🏷️ المشروع: <b>${alert.projectName}</b>\n` +
                    `⏰ الوقت: <b>${new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' })}</b>`;

                await sendTelegram(message);
                console.log(`🔔 Alert triggered: ${alert.coin} ${dirText} $${alert.targetPrice} (current: $${currentPrice})`);
            }
        }
    } catch (error) {
        console.error('⚠️ Price check error:', error.message);
    }
}

// تشغيل فحص الأسعار كل 30 ثانية
setInterval(checkPrices, 30000);

// أول فحص بعد 5 ثوانٍ من التشغيل
setTimeout(checkPrices, 5000);

// ============================================================
//  تشغيل السيرفر
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Alert Server running on port ${PORT}`);
    console.log(`📡 Telegram Bot: ${TELEGRAM_BOT_TOKEN ? 'Configured ✅' : 'Not configured ❌'}`);
    console.log(`💬 Chat ID: ${TELEGRAM_CHAT_ID ? 'Configured ✅' : 'Not configured ❌'}`);
});
