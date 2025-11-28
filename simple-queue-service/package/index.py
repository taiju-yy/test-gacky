import json
import boto3
import os
from linebot import LineBotApi
from linebot.models import TextSendMessage

def send_to_sqs(event, context):
    sqs = boto3.client('sqs')
    queue_url = os.environ.get('SQS_QUEUE_URL')
    
    # ユーザーIDのリストを取得
    user_ids = event['userIds']
    messages_to_send = event['messages']
    
    # 各ユーザーごとにSQSメッセージを作成
    for user_id in user_ids:
        message_body = {
            'userId': user_id,
            'messages': messages_to_send
        }
        
        # SQSにメッセージを送信
        sqs.send_message(
            QueueUrl=queue_url,
            MessageBody=json.dumps(message_body)
        )
    
    return {
        'statusCode': 200,
        'body': f'Queued messages for {len(user_ids)} users'
    }

# SQSからメッセージを受け取って処理するLambda関数
def process_sqs_messages(event, context):
    line_channel_token = os.environ.get('ACCESSTOKEN')
    line_bot_api = LineBotApi(line_channel_token)
    
    for record in event['Records']:
        try:
            # メッセージ本体を取得
            message_body = json.loads(record['body'])
            user_id = message_body['userId']
            messages = message_body['messages']
            
            # LINE APIを使用してメッセージを送信
            for message in messages:
                if message['messageType'] == 'text':
                    line_bot_api.push_message(
                        user_id,
                        TextSendMessage(text=message['message'])
                    )
            
        except Exception as e:
            print(f"Error processing message: {str(e)}")
            # エラーが発生した場合、メッセージはSQSのDead Letter Queueに移動される
            raise