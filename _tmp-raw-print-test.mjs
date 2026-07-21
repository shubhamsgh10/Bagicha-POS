import net from "net";

const HOST = process.argv[2] || "192.168.29.58";
const PORT = Number(process.argv[3] || 9100);

const bytes = Buffer.from([
  0x1b, 0x40, // init
  ...Array.from(Buffer.from("RAW TCP TEST OK 2\n\n\n")),
  0x1d, 0x56, 0x00, // cut (ignored if unsupported)
]);

const socket = net.createConnection({ host: HOST, port: PORT }, () => {
  console.log(`Connected to ${HOST}:${PORT}, writing ${bytes.length} bytes...`);
  socket.write(bytes, (err) => {
    if (err) {
      console.error("Write failed:", err.message);
      socket.destroy();
      process.exit(1);
    }
    console.log("Write completed — disarming watchdog and closing socket cleanly.");
    socket.setTimeout(0); // same fix as desktop/print/executor.ts
    socket.end();
  });
});

socket.setTimeout(5000, () => {
  console.error("Timed out waiting for connection/write (watchdog still armed at this point).");
  socket.destroy();
  process.exit(1);
});

socket.on("error", (err) => {
  console.error("Socket error:", err.message);
  process.exit(1);
});

socket.on("close", () => {
  console.log("Socket closed cleanly — no forced destroy.");
});
