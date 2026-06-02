import fs from "fs";
import { Client } from "ssh2";

export function runSshCommand(config, command) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const options = {
      host: config.host,
      port: config.port,
      username: config.username
    };

    if (config.privateKeyPath) {
      options.privateKey = fs.readFileSync(config.privateKeyPath, "utf8");
      if (config.passphrase) options.passphrase = config.passphrase;
    } else if (config.password) {
      options.password = config.password;
    }

    conn
      .on("ready", () => {
        conn.exec(command, { pty: false }, (err, stream) => {
          if (err) {
            conn.end();
            return reject(err);
          }
          let stdout = "";
          let stderr = "";
          stream
            .on("close", (code) => {
              conn.end();
              resolve({ code, stdout, stderr });
            })
            .on("data", (data) => {
              stdout += data.toString();
            })
            .stderr.on("data", (data) => {
              stderr += data.toString();
            });
        });
      })
      .on("error", (err) => reject(err))
      .connect(options);
  });
}
