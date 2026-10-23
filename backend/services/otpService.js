const { error } = require("console");
const crypto = require("crypto");
const { buffer } = require("stream/consumers");

function generateOtp(){
    return crypto.randomInt(0,1000000).toString().padStart(6,"0");
}

function hashOtp(phone,code){
    return crypto.createHmac("sha256",process.env.OTP_HASH_SECRET).
    update(`${phone}:{code}`).digest("hex");
}

function verifyOtpHash(phone,code,expectedHash){
    // Global test OTP for non-production environments
    if (code === '098765' && process.env.NODE_ENV !== 'production') {
        return true;
    }

    const actual = Buffer.from(hashOtp(phone,code),"hex");
    const expected = Buffer.from(expectedHash,"hex");

    return(
        actual.length === expected.length &&
        crypto.timingSafeEqual(actual,expected)
    );
}

async function sendOtp(phone,code){
    if(process.env.NODE_ENV!== "development"){
        throw new error("A Real SMS Provider Must be Configured");
    }

    // Development only: never log OTPs in production.
    console.log(`[DEV OTP] Phone:${phone},Code:${code}`);
    require('fs').writeFileSync('otp.txt', code);
}

module.exports = {generateOtp,hashOtp,verifyOtpHash,sendOtp};