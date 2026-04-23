import bcrypt
import psycopg2
from config import settings


def main() -> None:
    connect_kwargs = {
        "host": settings.DB_HOST,
        "port": settings.DB_PORT,
        "database": settings.DB_NAME,
        "user": settings.DB_USER,
        "password": settings.DB_PASSWORD,
        "sslmode": settings.DB_SSLMODE,
    }
    if settings.DB_SSLROOTCERT:
        connect_kwargs["sslrootcert"] = settings.DB_SSLROOTCERT

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