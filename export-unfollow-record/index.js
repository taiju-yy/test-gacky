const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

exports.handler = async (event) => {
    const userId = event.userId;
    const tableName = process.env.DYNAMODB_TABLE_NAME;
    const bucketName = process.env.S3_BUCKET_NAME;
    console.log('Try to export for', userId);

    try {
        const params = {
            TableName: tableName,
            FilterExpression: 'userId = :userId',
            ExpressionAttributeValues: {
                ':userId': userId
            }
        };

        const data = await dynamodb.scan(params).promise();

        const jsonData = JSON.stringify(data.Items);
        // console.log(jsonData);

        const s3Params = {
            Bucket: bucketName,
            Key: `export-${userId}-${Date.now()}.json`,
            Body: jsonData,
            ContentType: 'application/json'
        };

        await s3.putObject(s3Params).promise();

        return {
            statusCode: 200,
            body: JSON.stringify('Export Successful')
        };
    } catch (error) {
        console.error('Export error:', error.message, '\nStack:', error.stack);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Export failed', error: error.message })
        };
    }
};