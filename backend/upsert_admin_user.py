import os
import bcrypt
import psycopg2


def main() -> None:
    sslmode = os.getenv("DB_SSLMODE", "require")
    sslrootcert = os.getenv("DB_SSLROOTCERT", "")

    connect_kwargs = {
        "host": os.getenv("DB_HOST"),
        "port": os.getenv("DB_PORT"),
        "database": os.getenv("DB_NAME"),
        "user": os.getenv("DB_USER"),
        "password": os.getenv("DB_PASSWORD"),
        "sslmode": sslmode,
    }
    # Only pass sslrootcert when provided (avoids "file does not exist" errors).
    if sslrootcert:
        connect_kwargs["sslrootcert"] = sslrootcert

    conn = psycopg2.connect(**connect_kwargs)
    cur = conn.cursor()

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(100) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            email VARCHAR(255),
            role VARCHAR(20) DEFAULT 'viewer',
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login TIMESTAMP
        )
        """
    )

    admin_hash = bcrypt.hashpw(b"admin", bcrypt.gensalt()).decode()
    cur.execute(
        """
        INSERT INTO users (username, password_hash, email, role, is_active)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (username) DO UPDATE SET
            password_hash = EXCLUDED.password_hash,
            email = EXCLUDED.email,
            role = EXCLUDED.role,
            is_active = EXCLUDED.is_active
        """,
        ("admin", admin_hash, "admin@dashboard.local", "admin", True),
    )

    conn.commit()
    cur.execute(
        "SELECT username, role, is_active FROM users WHERE username = %s",
        ("admin",),
    )
    print("Upsert result:", cur.fetchone())
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
