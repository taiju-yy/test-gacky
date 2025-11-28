const axios = require("axios");


// LINEから画像を取得する
async function getImageContent(messageId) {
    const url = `https://api-data.line.me/v2/bot/message/${messageId}/content`;
  
    try {
      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${process.env.ACCESSTOKEN}`,
        },
        responseType: "arraybuffer",
      });
      return response.data;
    } catch (error) {
      console.error("Error fetching image content:", error);
      throw new Error("Failed to fetch image content");
    }
}

module.exports = { getImageContent };