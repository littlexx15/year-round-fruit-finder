const { scan, status } = require('../server');

(async () => {
  await scan();
  if (status.error) {
    console.error(status.message);
    process.exitCode = 1;
    return;
  }
  console.log(status.message);
})();
