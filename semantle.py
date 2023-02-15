import json
import pickle
from datetime import date, datetime

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from flask import (
    Flask,
    send_file,
    send_from_directory,
    jsonify,
    render_template,
    request,
)
from pytz import utc, timezone

import word2vec
from process_similar import get_nearest

KST = timezone('Asia/Seoul')

NUM_SECRETS = 4650
FIRST_DAY = date(2022, 4, 1)
scheduler = BackgroundScheduler()
scheduler.start()

app = Flask(__name__)
print("loading valid nearest")
with open('data/valid_nearest.dat', 'rb') as f:
    valid_nearest_words, valid_nearest_vecs = pickle.load(f)
with open('data/secrets.txt', 'r', encoding='utf-8') as f:
    secrets = [l.strip() for l in f.readlines()]
print("initializing nearest words for solutions")
app.secrets = dict()
app.nearests = dict()
current_puzzle = (utc.localize(datetime.utcnow()).astimezone(KST).date() - FIRST_DAY).days % NUM_SECRETS
for puzzle_number in range(current_puzzle):
    secret_word = secrets[puzzle_number]
    app.secrets[puzzle_number] = secret_word
    app.nearests[puzzle_number] = get_nearest(puzzle_number, secret_word, valid_nearest_words, valid_nearest_vecs)
    print(end='', flush=True)

print("initializing leaderboards")
app.leaderboards = dict()
app.leaders = dict()


def get_records(day: int):
    return app.leaderboards[day] if day in app.leaderboards else []


def add_record_to_db(record: dict):
    with open('data/records.txt', 'a', encoding='utf-8') as f:
        f.write(json.dumps(record) + '\n')


def add_record_to_leaderboard(record: dict):
    day = record['day']
    records = get_records(day)
    records = records + [record]
    records = sorted(records, key=lambda x: x['guess_count'])
    app.leaderboards[day] = records
    app.leaders[day] = records[0]

with open('data/records.txt', 'r', encoding='utf-8') as f:
    for line in f.readlines():
        record = json.loads(line)
        add_record_to_leaderboard(record)


@scheduler.scheduled_job(trigger=CronTrigger(hour=0, minute=0, timezone=KST))
def update_nearest():
    print("scheduled stuff triggered!")
    next_puzzle = ((utc.localize(datetime.utcnow()).astimezone(KST).date() - FIRST_DAY).days) % NUM_SECRETS
    next_word = secrets[next_puzzle]
    app.secrets[next_puzzle] = next_word
    app.nearests[next_puzzle] = get_nearest(next_puzzle, next_word, valid_nearest_words, valid_nearest_vecs)


@app.route('/')
def get_days():
    items=[
        {
            'day': day,
            'leader': app.leaders[day] if day in app.leaders else '없음',
        }
        for day in app.secrets.keys()
    ]
    return render_template('days.html', items=items)


@app.route('/<int:day>')
def get_index_by_day(day: int):
    return render_template('index.html', day=day)


@app.route('/robots.txt')
def robots():
    return send_file("static/assets/robots.txt")


@app.route("/favicon.ico")
def send_favicon():
    return send_file("static/assets/favicon.ico")


@app.route("/assets/<path:path>")
def send_static(path):
    return send_from_directory("static/assets", path)


@app.route('/guess/<int:day>/<string:word>')
def get_guess(day: int, word: str):
    print(app.secrets[day])
    if app.secrets[day].lower() == word.lower():
        word = app.secrets[day]
    rtn = {"guess": word}
    # check most similar
    if day in app.nearests and word in app.nearests[day]:
        rtn["sim"] = app.nearests[day][word][1]
        rtn["rank"] = app.nearests[day][word][0]
    else:
        try:
            rtn["sim"] = word2vec.similarity(app.secrets[day], word)
            rtn["rank"] = "1000위 이상"
        except KeyError:
            return jsonify({"error": "unknown"}), 404
    return jsonify(rtn)


@app.route('/similarity/<int:day>')
def get_similarity(day: int):
    nearest_dists = sorted([v[1] for v in app.nearests[day].values()])
    leader = app.leaders[day] if day in app.leaders else None
    return jsonify({"top": nearest_dists[-2], "top10": nearest_dists[-11], "rest": nearest_dists[0], "leader": leader})


@app.route('/yesterday/<int:today>')
def get_solution_yesterday(today: int):
    yesterday = (today - 1) % NUM_SECRETS
    if yesterday not in app.secrets:
        return '???'
    return app.secrets[yesterday]


@app.route('/nearest1k/<int:day>')
def get_nearest_1k(day: int):
    if day not in app.secrets:
        return "이 날의 가장 유사한 단어는 현재 사용할 수 없습니다.", 404
    solution = app.secrets[day]
    words = [
        dict(
            word=w,
            rank=k[0],
            similarity="%0.2f" % (k[1] * 100))
        for w, k in app.nearests[day].items() if w != solution]
    return render_template('top1k.html', word=solution, words=words, day=day)


@app.route('/giveup/<int:day>')
def give_up(day: int):
    if day not in app.secrets:
        return '저런...', 404
    else:
        return app.secrets[day]


@app.route('/leaderboard/<int:day>')
def get_leaderboard(day: int):
    leaderboard = app.leaderboards[day] if day in app.leaderboards else []
    records = [
        dict(
            rank=i+1,
            nickname=record['nickname'],
            timestamp=utc.localize(datetime.fromtimestamp(record['timestamp'])).astimezone(KST).strftime('%Y-%m-%d %H:%M:%S'),
            guess_count=record['guess_count'],
        ) for i, record in enumerate(leaderboard)
    ]
    return render_template('leaderboard.html', day=day, records=records)


@app.route('/record/<int:day>', methods=['POST'])
def submit_record(day: int):
    params = request.get_json()
    record = {
        'day': day,
        'timestamp': datetime.utcnow().timestamp(),
        'nickname': params['nickname'],
        'guess_count': params['guess_count'],
    }

    add_record_to_db(record)
    add_record_to_leaderboard(record)
    print(f"Add record: {record}", flush=True)

    return jsonify({'status': 'ok'})
