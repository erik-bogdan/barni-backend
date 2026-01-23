{ pkgs, lib, config, ... }:
{
  ####################
  # Packages
  ####################
  packages = [
    pkgs.git
    pkgs.curl


    # Go + bimg (libvips) native deps
    pkgs.vips
    pkgs.pkg-config
    pkgs.clang
    pkgs.gnumake

    # Next build toolchain (néha kell native modulokhoz)
    pkgs.nodejs_20
  ];

  ####################
  # Env
  ####################
  env = {
    # Postgres
    POSTGRES_HOST = "127.0.0.1";
    POSTGRES_PORT = "5432";
    POSTGRES_USER = "barnimesei";
    POSTGRES_PASSWORD = "barnimesei";
    POSTGRES_DB = "barnimesei";

    # RabbitMQ
    RABBITMQ_HOST = "127.0.0.1";
    RABBITMQ_PORT = "5672";
    RABBITMQ_MANAGEMENT_PORT = "15672";
    RABBITMQ_DEFAULT_USER = "admin";
    RABBITMQ_DEFAULT_PASS = "password";

    # Redis
    REDIS_HOST = "127.0.0.1";
    REDIS_PORT = "6379";

    # MinIO
    MINIO_ENDPOINT = "http://127.0.0.1:9000";
    MINIO_CONSOLE = "http://127.0.0.1:9001";
    MINIO_ROOT_USER = "barnimesei";
    MINIO_ROOT_PASSWORD = "barnimesei123";
    MINIO_DEFAULT_BUCKETS = "barnimesei";


    MAIL_PROVIDER = "nodemailer";
    MAIL_FROM = "noreply@yourapp.com";
    SMTP_HOST = "127.0.0.1";
    SMTP_PORT = "1025";
    SMTP_SECURE = "false";
    SMTP_USER = "your-email@gmail.com";
    SMTP_PASS = "your-app-password";
    MAILGUN_API_KEY = "your-mailgun-api-key";
    MAILGUN_DOMAIN = "your-mailgun-domain.com";
    MAILGUN_BASE_URL = "https://api.mailgun.net";


    # Go / CGO / libvips
    CGO_ENABLED = "1";
    PKG_CONFIG_PATH =
      "${pkgs.vips.dev}/lib/pkgconfig:"
      + "${pkgs.glib.dev}/lib/pkgconfig:"
      + "${pkgs.pango.dev}/lib/pkgconfig:"
      + "${pkgs.cairo.dev}/lib/pkgconfig";

    # Next: biztosan ne “telemetry + exit” jelleg legyen
    NEXT_TELEMETRY_DISABLED = "1";
  };

  ####################
  # Languages
  ####################
  languages = {
    go.enable = true;
    javascript = {
      enable = true;
      yarn.enable = true;
      bun.enable = true;
    };
  };

  ####################
  # Services
  ####################
  services = {
    mailpit.enable = true;



    postgres = {
      enable = true;
      listen_addresses = "127.0.0.1";
      port = 5432;
      initialDatabases = [
        {
          name = "barnimesei";
          user = "barnimesei";
          pass = "barnimesei";
        }
      ];
    };

    rabbitmq = {
      enable = true;
      listenAddress = "127.0.0.1";
      port = 5672;
      managementPlugin.enable = true;
      managementPlugin.port = 15672;
    };

    redis.enable = true;

    minio = {
      enable = true;
      accessKey = "barnimesei";
      secretKey = "barnimesei123";
      buckets = [ "barnimesei" ];
      listenAddress = "127.0.0.1:9000";
      consoleAddress = "127.0.0.1:9001";
    };
  };

  ####################
  # Processes
  ####################
  processes = {
    rabbitmq-init = {
      exec = ''
        set -euo pipefail

        echo "Waiting for RabbitMQ..."
        until rabbitmqctl -n rabbit@localhost status >/dev/null 2>&1; do
          sleep 1
        done

        rabbitmqctl -n rabbit@localhost add_user "$RABBITMQ_DEFAULT_USER" "$RABBITMQ_DEFAULT_PASS" 2>/dev/null || true
        rabbitmqctl -n rabbit@localhost set_user_tags "$RABBITMQ_DEFAULT_USER" administrator 2>/dev/null || true
        rabbitmqctl -n rabbit@localhost set_permissions -p / "$RABBITMQ_DEFAULT_USER" ".*" ".*" ".*" 2>/dev/null || true
        rabbitmqctl -n rabbit@localhost delete_user guest 2>/dev/null || true

        echo "RabbitMQ admin user ensured."
      '';
      process-compose.depends_on.rabbitmq.condition = "process_healthy";
    };


    backend = {
      exec = ''
        set -euo pipefail
        cd .

        echo "Waiting for MinIO..."
        until curl -fsS http://127.0.0.1:9000/minio/health/ready > /dev/null; do
          sleep 1
        done
        echo "MinIO is ready."

        bun run dev
      '';
      process-compose.depends_on = {
        postgres.condition = "process_healthy";
        redis.condition = "process_healthy";
        rabbitmq.condition = "process_healthy";
        rabbitmq-init.condition = "process_completed_successfully";
        minio.condition = "process_started";
      };
      process-compose.availability.restart = "always";
    };

    worker = {
      exec = ''
        set -euo pipefail
        cd .

        echo "Starting story worker..."
        bun run worker
      '';
      process-compose.depends_on = {
        postgres.condition = "process_healthy";
        rabbitmq.condition = "process_healthy";
        rabbitmq-init.condition = "process_completed_successfully";
        minio.condition = "process_started";
      };
      process-compose.availability.restart = "always";
    };
    audio-worker = {
      exec = ''
        set -euo pipefail
        cd .

        echo "Starting story audio worker..."
        bun run worker:audio
      '';
      process-compose.depends_on = {
        postgres.condition = "process_healthy";
        rabbitmq.condition = "process_healthy";
        rabbitmq-init.condition = "process_completed_successfully";
        minio.condition = "process_started";
      };
      process-compose.availability.restart = "always";
    };

    # FIX: Next dev szerver biztos indítása (node_modules/.bin/next)
    frontend = {
      exec = ''
        set -euo pipefail
        cd ../admin

        # ha nincs node_modules, rakjuk fel (különben a next parancs nem létezik)
        if [ ! -d node_modules ]; then
          echo "node_modules missing -> yarn install"
          yarn install --frozen-lockfile || yarn install
        fi

        echo "Starting Next.js dev server..."
        ./node_modules/.bin/next dev -H 0.0.0.0 -p 3001
      '';
      process-compose.depends_on.backend.condition = "process_started";
      process-compose.availability.restart = "always";
    };

  };
}
