import os
import asyncio
from aiogram import Bot, Dispatcher, F
from aiogram.types import Message, CallbackQuery
from aiogram.filters import CommandStart
from aiogram.utils.keyboard import InlineKeyboardBuilder
from aiogram.enums import ParseMode

from utils import log_user, encrypt_payload, decrypt_payload

BOT_TOKEN = os.getenv("BOT_TOKEN")
CHANNEL_ID = int(os.getenv("CHANNEL_ID"))
SECRET_KEY = os.getenv("SECRET_KEY")

if not BOT_TOKEN or not CHANNEL_ID or not SECRET_KEY:
    raise Exception("Missing environment variables!")

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

MAX_FILES = 50

# Simple in-memory session store
sessions = {}


def get_session(user_id: int):
    if user_id not in sessions:
        sessions[user_id] = {
            "temp_ids": [],
            "awaiting_lock": False,
            "pending_payload": None,
            "awaiting_passcode": False,
            "last_status_msg_id": None
        }
    return sessions[user_id]


# ---------------- START ----------------
@dp.message(CommandStart())
async def start_handler(message: Message):
    log_user(message.from_user.id)
    session = get_session(message.from_user.id)

    payload = message.text.split(" ", 1)
    payload = payload[1] if len(payload) > 1 else None

    if payload:
        data = decrypt_payload(payload, SECRET_KEY)
        if not data:
            return await message.answer("❌ Invalid or expired link.")

        if data.get("passcode"):
            session["pending_payload"] = data
            session["awaiting_passcode"] = True
            return await message.answer(
                "🔐 This file is locked.\nEnter 4-digit passcode:"
            )

        return await send_files(message, data["ids"])

    welcome = (
        "🚀 *Welcome to File Store Bot!*\n\n"
        "Upload files and get secure links.\n\n"
        "1. Send files\n"
        "2. Generate link\n"
        "3. Share anywhere!"
    )

    await message.answer(welcome, parse_mode=ParseMode.MARKDOWN)


# ---------------- FILE HANDLER ----------------
@dp.message(F.photo | F.video | F.document | F.audio)
async def file_handler(message: Message):
    session = get_session(message.from_user.id)

    if len(session["temp_ids"]) >= MAX_FILES:
        return await message.answer(f"❌ Max {MAX_FILES} files allowed.")

    try:
        forwarded = await bot.forward_message(
            chat_id=CHANNEL_ID,
            from_chat_id=message.chat.id,
            message_id=message.message_id
        )

        session["temp_ids"].append(forwarded.message_id)

        try:
            await message.delete()
        except:
            pass

        count = len(session["temp_ids"])

        kb = InlineKeyboardBuilder()
        kb.button(text="Upload", callback_data="gen_no_lock")
        kb.button(text="Upload with lock", callback_data="gen_with_lock")

        text = f"✅ {count} file(s) received.\nGenerate link or add more."

        if session["last_status_msg_id"]:
            try:
                await bot.edit_message_text(
                    chat_id=message.chat.id,
                    message_id=session["last_status_msg_id"],
                    text=text,
                    reply_markup=kb.as_markup()
                )
            except:
                msg = await message.answer(text, reply_markup=kb.as_markup())
                session["last_status_msg_id"] = msg.message_id
        else:
            msg = await message.answer(text, reply_markup=kb.as_markup())
            session["last_status_msg_id"] = msg.message_id

    except Exception as e:
        print(e)
        await message.answer("❌ Storage channel error.")


# ---------------- CALLBACK ----------------
@dp.callback_query()
async def callback_handler(callback: CallbackQuery):
    session = get_session(callback.from_user.id)

    if callback.data == "gen_no_lock":
        await callback.answer()
        await generate_link(callback.message, session, None)

    elif callback.data == "gen_with_lock":
        await callback.answer()
        session["awaiting_lock"] = True
        await callback.message.answer("🔐 Enter 4-digit PIN:")


# ---------------- TEXT HANDLER ----------------
@dp.message(F.text)
async def text_handler(message: Message):
    session = get_session(message.from_user.id)
    text = message.text.strip()

    # LOCK SETTING
    if session["awaiting_lock"]:
        if text.isdigit() and len(text) == 4:
            session["awaiting_lock"] = False
            return await generate_link(message, session, text)
        else:
            return await message.answer("❌ Enter exactly 4 digits.")

    # PASSCODE CHECK
    if session["awaiting_passcode"]:
        data = session["pending_payload"]

        if text == data["passcode"]:
            session["awaiting_passcode"] = False
            session["pending_payload"] = None
            await message.answer("✅ Access granted!")
            return await send_files(message, data["ids"])
        else:
            session["awaiting_passcode"] = False
            session["pending_payload"] = None
            return await message.answer("❌ Wrong passcode.")


# ---------------- GENERATE LINK ----------------
async def generate_link(message: Message, session, lock_code):
    if not session["temp_ids"]:
        return

    me = await bot.get_me()

    payload = encrypt_payload(session["temp_ids"], lock_code, SECRET_KEY)
    link = f"https://t.me/{me.username}?start={payload}"

    await message.answer(
        f"🎉 Link Generated!\n\n"
        f"📦 Files: {len(session['temp_ids'])}\n"
        f"🔐 Lock: {lock_code or 'None'}\n\n"
        f"`{link}`",
        parse_mode=ParseMode.MARKDOWN
    )

    session["temp_ids"] = []
    session["awaiting_lock"] = False
    session["last_status_msg_id"] = None


# ---------------- SEND FILES ----------------
async def send_files(message: Message, ids):
    for mid in ids:
        try:
            await bot.copy_message(
                chat_id=message.chat.id,
                from_chat_id=CHANNEL_ID,
                message_id=mid
            )
        except:
            pass


# ---------------- START BOT ----------------
async def main():
    print("Bot is running...")
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
