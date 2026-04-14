import psycopg2
import bcrypt

conn = psycopg2.connect(
    host="localhost",
    port=5432,
    database="proxmox_dashboard",
    user="proxmox",
    password="proxmox123"
)
cursor = conn.cursor()

# Admin user
admin_hash = bcrypt.hashpw(b"admin", bcrypt.gensalt()).decode()
cursor.execute(
    "INSERT INTO users (username, password_hash, email, role, is_active) VALUES (%s, %s, %s, %s, %s)",
    ("admin", admin_hash, "admin@dashboard.local", "admin", True)
)

# Regular user
user_hash = bcrypt.hashpw(b"user", bcrypt.gensalt()).decode()
cursor.execute(
    "INSERT INTO users (username, password_hash, email, role, is_active) VALUES (%s, %s, %s, %s, %s)",
    ("user", user_hash, "user@dashboard.local", "viewer", True)
)

conn.commit()
cursor.execute("SELECT username, role FROM users")
print("Users created:", cursor.fetchall())
conn.close()