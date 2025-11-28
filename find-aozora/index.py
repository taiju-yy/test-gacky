import json
import boto3
import requests
from math import radians, sin, cos, sqrt, atan2
import urllib.parse

# DynamoDBクライアントの設定
dynamodb = boto3.resource('dynamodb')
pharmacy_table = dynamodb.Table('Pharmacies')

# LINE Messaging APIの設定
LINE_CHANNEL_ACCESS_TOKEN = 'あなたのLINEチャンネルアクセストークン'
LINE_API_URL = 'https://api.line.me/v2/bot/message/reply'

# Claude APIの設定
CLAUDE_API_KEY = 'あなたのClaude APIキー'
CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'

def calculate_distance(lat1, lon1, lat2, lon2):
    R = 6371  # 地球の半径（km）

    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1

    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    c = 2 * atan2(sqrt(a), sqrt(1-a))
    distance = R * c

    return distance

def find_nearest_pharmacy(user_lat, user_lon):
    response = pharmacy_table.scan()
    pharmacies = response['Items']

    nearest_pharmacy = min(pharmacies, key=lambda p: calculate_distance(user_lat, user_lon, p['latitude'], p['longitude']))
    return nearest_pharmacy

def format_pharmacy_info(pharmacy, user_lat, user_lon):
    distance = calculate_distance(user_lat, user_lon, pharmacy['latitude'], pharmacy['longitude'])
    
    prompt = f"以下の薬局情報を簡潔に日本語でユーザーに案内してください。薬局名: {pharmacy['name']}, 住所: {pharmacy['address']}, 距離: {distance:.2f}km"
    
    response = requests.post(CLAUDE_API_URL, 
        headers={
            'Content-Type': 'application/json',
            'x-api-key': CLAUDE_API_KEY
        },
        json={
            'model': 'claude-3-sonnet-20240229',
            'messages': [{'role': 'user', 'content': prompt}],
            'max_tokens': 300
        }
    )
    
    return response.json()['content'][0]['text']

def create_google_maps_url(start_lat, start_lon, end_lat, end_lon):
    base_url = "https://www.google.com/maps/dir/?api=1"
    params = {
        "origin": f"{start_lat},{start_lon}",
        "destination": f"{end_lat},{end_lon}",
        "travelmode": "walking"
    }
    return f"{base_url}&{urllib.parse.urlencode(params)}"

def send_line_message(reply_token, messages):
    requests.post(LINE_API_URL, 
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {LINE_CHANNEL_ACCESS_TOKEN}'
        },
        json={
            'replyToken': reply_token,
            'messages': messages
        }
    )

def handle_location_message(event):
    user_lat = event['message']['latitude']
    user_lon = event['message']['longitude']
    
    nearest_pharmacy = find_nearest_pharmacy(user_lat, user_lon)
    formatted_info = format_pharmacy_info(nearest_pharmacy, user_lat, user_lon)
    
    google_maps_url = create_google_maps_url(user_lat, user_lon, nearest_pharmacy['latitude'], nearest_pharmacy['longitude'])
    
    flex_message = {
        "type": "flex",
        "altText": "最寄りの薬局情報",
        "contents": {
            "type": "bubble",
            "body": {
                "type": "box",
                "layout": "vertical",
                "contents": [
                    {
                        "type": "text",
                        "text": formatted_info,
                        "wrap": True
                    },
                    {
                        "type": "button",
                        "style": "link",
                        "height": "sm",
                        "action": {
                            "type": "uri",
                            "label": "Google Mapsで見る",
                            "uri": google_maps_url
                        }
                    }
                ]
            }
        }
    }
    
    send_line_message(event['replyToken'], [flex_message])

def handle_postback_event(event):
    if event['postback']['data'] == 'find_pharmacy':
        location_request_message = {
            "type": "text",
            "text": "最寄りの薬局を探すには、位置情報を送信してください。",
            "quickReply": {
                "items": [
                    {
                        "type": "action",
                        "action": {
                            "type": "location",
                            "label": "位置情報を送信"
                        }
                    }
                ]
            }
        }
        send_line_message(event['replyToken'], [location_request_message])

def lambda_handler(event, context):
    body = json.loads(event['body'])
    
    for line_event in body['events']:
        if line_event['type'] == 'message' and line_event['message']['type'] == 'location':
            handle_location_message(line_event)
        elif line_event['type'] == 'postback':
            handle_postback_event(line_event)
    
    return {'statusCode': 200, 'body': json.dumps('OK')}