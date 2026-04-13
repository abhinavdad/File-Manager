import os
import json
import base64
import hashlib
from Crypto.Cipher import AES
from Crypto.Random import get_random_bytes

USERS_FILE = "users.txt"

if not os.path.exists(USERS_FILE):
    open(USERS_FILE, "w").write("")


# ---------------- USER LOG ----------------
def log_user(user_id: int):
    with open(USERS_FILE, "r") as f:
        data = f.read().strip()

    users = [u for u in data.split(",") if u]

    if str(user_id) not in users:
        users.append(str(user_id))
        with open(USERS_FILE, "w") as f:
            f.write(",".join(users))
        return True

    return False


# ---------------- ENCRYPT ----------------
def encrypt_payload(ids, passcode, secret_key):
    key = hashlib.sha256(secret_key.encode()).digest()
    iv = get_random_bytes(16)

    pc = int(passcode or "0000")
    base_id = min(ids)

    mask = 0

    for i in ids:
        offset = i - base_id
        if offset < 64:
            mask |= (1 << offset)

    payload = (
        pc.to_bytes(2, "big") +
        base_id.to_bytes(4, "big") +
        mask.to_bytes(8, "big")
    )

    cipher = AES.new(key, AES.MODE_CBC, iv)

    pad_len = 16 - len(payload) % 16
    payload += bytes([pad_len]) * pad_len

    encrypted = cipher.encrypt(payload)

    return base64.urlsafe_b64encode(iv + encrypted).decode()


# ---------------- DECRYPT ----------------
def decrypt_payload(data, secret_key):
    try:
        key = hashlib.sha256(secret_key.encode()).digest()
        raw = base64.urlsafe_b64decode(data)

        iv = raw[:16]
        enc = raw[16:]

        cipher = AES.new(key, AES.MODE_CBC, iv)
        decrypted = cipher.decrypt(enc)

        pad = decrypted[-1]
        decrypted = decrypted[:-pad]

        passcode = int.from_bytes(decrypted[0:2], "big")
        base_id = int.from_bytes(decrypted[2:6], "big")
        mask = int.from_bytes(decrypted[6:14], "big")

        ids = []
        for i in range(64):
            if mask & (1 << i):
                ids.append(base_id + i)

        return {
            "ids": ids,
            "passcode": str(passcode).zfill(4) if passcode != 0 else None
        }

    except:
        return None
