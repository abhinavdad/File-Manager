require('dotenv').config();
const { Bot, session, InlineKeyboard } = require('grammy');
const { logUser, encryptPayload, decryptPayload } = require('./utils');

const { BOT_TOKEN, CHANNEL_ID, SECRET_KEY } = process.env;

if (!BOT_TOKEN || !CHANNEL_ID || !SECRET_KEY) {
    console.error("Missing environment variables!");
    process.exit(1);
}

const MAX_FILES = 50;
const bot = new Bot(BOT_TOKEN);

// Session storage
bot.use(session({
    initial: () => ({
        tempIds: [],
        awaitingLock: false,
        pendingPayload: null,
        awaitingPasscode: false,
        lastStatusMsgId: null
    })
}));

// Start command
bot.command('start', async (ctx) => {
    logUser(ctx.from.id);
    const payload = ctx.match;

    if (payload) {
        const data = decryptPayload(payload, SECRET_KEY);
        if (!data) return ctx.reply("❌ Invalid or expired link.");

        if (data.passcode) {
            ctx.session.pendingPayload = data;
            ctx.session.awaitingPasscode = true;
            return ctx.reply("🔐 *This file is locked.*\nPlease enter the 4-digit passcode to access it:", { parse_mode: "Markdown" });
        }
        return sendFiles(ctx, data.ids);
    }

    // New Public welcome message
    const welcomeText = 
        "🚀 *Welcome to File Store Bot!*\n\n" +
        "Upload files and get your own private sharing links instantly. " +
        "Everything is secure and protected with *AES-256 encryption* and optional *4-digit locks*.\n\n" +
        "👇 *How to use:*\n" +
        "1. Send me any files (Images, Videos, or Documents).\n" +
        "2. Click the 'Upload' button to get your link.\n" +
        "3. Share with anyone!";

    await ctx.reply(welcomeText, { parse_mode: "Markdown" });
});

// File upload handling (Public)
bot.on(['message:photo', 'message:video', 'message:document', 'message:audio'], async (ctx) => {
    if (ctx.session.tempIds.length >= MAX_FILES) {
        return ctx.reply(`❌ Maximum ${MAX_FILES} files can be stored in a single link.`);
    }

    try {
        // Forward to storage
        const forwarded = await ctx.forwardMessage(CHANNEL_ID);
        ctx.session.tempIds.push(forwarded.message_id);

        // Delete the original file from user's chat
        try { await ctx.deleteMessage(); } catch (e) {}

        const count = ctx.session.tempIds.length;
        const keyboard = new InlineKeyboard()
            .text("Upload", "gen_no_lock")
            .row()
            .text("Upload with lock", "gen_with_lock");

        const msgText = `✅ *${count} file${count > 1 ? 's' : ''} received.*\n\n` +
                        `Send another or click the button below to generate a link.`;

        if (ctx.session.lastStatusMsgId) {
            try {
                await ctx.api.editMessageText(ctx.chat.id, ctx.session.lastStatusMsgId, msgText, {
                    parse_mode: "Markdown",
                    reply_markup: keyboard
                });
            } catch (e) {
                const msg = await ctx.reply(msgText, { parse_mode: "Markdown", reply_markup: keyboard });
                ctx.session.lastStatusMsgId = msg.message_id;
            }
        } else {
            const msg = await ctx.reply(msgText, { parse_mode: "Markdown", reply_markup: keyboard });
            ctx.session.lastStatusMsgId = msg.message_id;
        }
    } catch (error) {
        console.error(error);
        ctx.reply("❌ Error: Storage channel unavailable.");
    }
});

// Callback query handling (Public)
bot.on("callback_query:data", async (ctx) => {
    if (ctx.callbackQuery.data === "gen_no_lock") {
        await ctx.answerCallbackQuery();
        await generateFinalLink(ctx, null);
    } 
    else if (ctx.callbackQuery.data === "gen_with_lock") {
        await ctx.answerCallbackQuery();
        ctx.session.awaitingLock = true;
        await ctx.reply("🔐 *Enter a 4-digit numerical pin* for this link:", { parse_mode: "Markdown" });
        
        if (ctx.session.lastStatusMsgId) {
            try {
                await ctx.api.editMessageReplyMarkup(ctx.chat.id, ctx.session.lastStatusMsgId, { reply_markup: null });
            } catch (e) {}
        }
    }
});

// Text input handling (Passcodes and Locks)
bot.on('message:text', async (ctx) => {
    // Setting lock for new link
    if (ctx.session.awaitingLock) {
        const input = ctx.message.text.trim();
        if (/^\d{4}$/.test(input)) {
            generateFinalLink(ctx, input);
        } else {
            ctx.reply("❌ Access code must be exactly *4 numerical digits*. Try again:", { parse_mode: "Markdown" });
        }
        return;
    }

    // Entering passcode to get files
    if (ctx.session.awaitingPasscode) {
        const input = ctx.message.text.trim();
        const data = ctx.session.pendingPayload;

        if (input === data.passcode) {
            ctx.session.awaitingPasscode = false;
            ctx.session.pendingPayload = null;
            await ctx.reply("✅ *Access granted!* Sending files...", { parse_mode: "Markdown" });
            return sendFiles(ctx, data.ids);
        } else {
            ctx.session.awaitingPasscode = false;
            ctx.session.pendingPayload = null;
            return ctx.reply("❌ *Incorrect passcode.* Access denied.", { parse_mode: "Markdown" });
        }
    }
});

/**
 * Generate final link and reset
 */
async function generateFinalLink(ctx, lockCode) {
    if (ctx.session.tempIds.length === 0) return;

    const me = await bot.api.getMe();
    const payload = encryptPayload(ctx.session.tempIds, lockCode, SECRET_KEY);
    const link = `https://t.me/${me.username}?start=${payload}`;

    await ctx.reply(
        `🎉 *Link Generated!*\n\n` +
        `📦 Files: ${ctx.session.tempIds.length}\n` +
        `🔐 Lock: ${lockCode || 'None'}\n\n` +
        `🔗 \`${link}\``,
        { parse_mode: "Markdown" }
    );

    // Reset session
    ctx.session.tempIds = [];
    ctx.session.awaitingLock = false;
    ctx.session.lastStatusMsgId = null;
}

/**
 * Copy file list from channel to user
 */
async function sendFiles(ctx, ids) {
    for (const id of ids) {
        try {
            await bot.api.copyMessage(ctx.from.id, CHANNEL_ID, id);
        } catch (e) {
            // Message might be deleted in the storage channel
        }
    }
}

bot.catch((err) => console.error("Bot Error:", err));

bot.start({
    onStart: (me) => console.log(`Bot @${me.username} is running! (PUBLIC MODE)`),
});
