# Disk Health Remote

UI em Node.js + Bootstrap para coletar saude de discos via SSH e salvar historico em JSONL/CSV.

## Requisitos no servidor remoto

- `lsblk`
- `smartctl` (smartmontools)
- Permissao para rodar `smartctl` (root ou sudo sem senha)

## Configuracao

1. Copie `.env.example` para `.env` e edite.
2. Instale deps e rode:

```bash
npm install
npm start
```

Acesse: `http://localhost:3000`.

### Agendamento

Habilite no `.env`:

```
SCHEDULE_ENABLED=true
SCHEDULE_DAILY_TIME=14:00
```

## Docker

```bash
docker build -t disk-health-remote .
docker run --env-file .env -p 3000:3000 -v $(pwd)/data:/app/data disk-health-remote
```

## Historico

- JSONL: `data/snapshots.jsonl`
- CSV: `data/snapshots.csv`

Cada coleta cria um snapshot com os dados de todos os discos.
