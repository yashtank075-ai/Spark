const { spawn } = require("child_process");
const path = require("path");

class FaceVerificationService {
  constructor() {
    this.pythonPath = process.env.PYTHON_PATH || "python";
    this.workerPath = path.join(__dirname, "faceVerificationWorker.py");
    // Standard cosine similarity threshold for buffalo_sc 512-d normalized embeddings
    // Default 0.40 provides balanced FAR / FRR for identity verification. Configurable via env.
    this.threshold = parseFloat(process.env.FACE_MATCH_THRESHOLD || "0.40");
    this.timeoutMs = parseInt(process.env.FACE_VERIFICATION_TIMEOUT_MS || "20000", 10);
  }

  /**
   * Verify face matching between two image buffers.
   *
   * @param {Buffer} selfieBuffer - Verification selfie image buffer
   * @param {Buffer} profilePhotoBuffer - Approved profile photo image buffer
   * @param {object} [options] - Optional overrides (threshold)
   * @returns {Promise<{
   *   success: boolean,
   *   match: boolean,
   *   similarity: number,
   *   threshold: number,
   *   model: string,
   *   error?: string,
   *   message?: string
   * }>}
   */
  async compareFaces(selfieBuffer, profilePhotoBuffer, options = {}) {
    if (!Buffer.isBuffer(selfieBuffer) || !Buffer.isBuffer(profilePhotoBuffer)) {
      throw new Error("Both selfie and profile photo must be valid Buffer instances.");
    }

    const payload = {
      image1_base64: selfieBuffer.toString("base64"),
      image2_base64: profilePhotoBuffer.toString("base64"),
      threshold: options.threshold !== undefined ? options.threshold : this.threshold,
    };

    return new Promise((resolve, reject) => {
      let isSettled = false;
      const child = spawn(this.pythonPath, [this.workerPath], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdoutData = "";
      let stderrData = "";

      const timer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          child.kill("SIGKILL");
          reject(new Error("FACE_VERIFICATION_TIMEOUT"));
        }
      }, this.timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdoutData += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderrData += chunk.toString();
      });

      child.on("error", (spawnErr) => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timer);
          reject(new Error(`Failed to start face verification worker: ${spawnErr.message}`));
        }
      });

      child.on("close", (code) => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timer);

        if (code !== 0 && !stdoutData.trim()) {
          return reject(
            new Error(
              `Face verification worker exited with code ${code}. Error: ${stderrData.trim() || "Unknown error"}`
            )
          );
        }

        try {
          const result = JSON.parse(stdoutData.trim());
          resolve(result);
        } catch (parseErr) {
          reject(
            new Error(
              `Failed to parse face verification worker output: ${parseErr.message}. Output was: ${stdoutData}`
            )
          );
        }
      });

      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    });
  }
}

module.exports = new FaceVerificationService();
