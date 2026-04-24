import bcrypt

conn_data = {
    "host": "syam-projectwork-pontos.c9nj1x2p6gk5.eu-west-1.rds.amazonaws.com",
    "port": 5432,
    "database": "postgres",
    "user": "pontos",
    "password": "G@lb@tor0!23"
}

import psycopg2
conn = psycopg2.connect(**conn_data)
cur = conn.cursor()
cur.execute("SELECT username, password_hash FROM users WHERE username = 'admin'")
row = cur.fetchone()
if row:
    print(f"User: {row[0]}")
    print(f"Hash: {row[1][:60]}...")
    
    for pwd in ['admin', 'NuovaPass123!', 'NuovaPass456!', 'NuovaPass789!']:
        try:
            result = bcrypt.checkpw(pwd.encode(), row[1].encode())
            print(f"  '{pwd}' -> {result}")
        except Exception as e:
            print(f"  '{pwd}' -> Error: {e}")
else:
    print("Admin user not found")

cur.close()
conn.close()