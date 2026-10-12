#
# rig_test.py: Hamlib疎通テストツール
#
# インストールしたHamlib rigctldを使ってリグを制御できるかどうかをテストするツールです。
# 失敗した場合の原因の診断にも使えます。
#

# --- Setting ---
RIGCTLD_HOST = '127.0.0.1'
RIGCTLD_PORT = 4533

import socket
import sys

def diagnose_rigctld(host=RIGCTLD_HOST, port=RIGCTLD_PORT):

    print(f"--- 診断開始: {host}:{port} ---")
    
    # 1. ソケット接続テスト
    try:
        client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        client.settimeout(2.0)  # 2秒でタイムアウト
        client.connect((host, port))
        print("[通信] rigctld への接続に成功しました。")
    except ConnectionRefusedError:
        print("[エラー] 接続が拒否されました。rigctld が起動していないか、ポート番号が違います。")
        return
    except socket.timeout:
        print("[エラー] タイムアウトしました。ネットワーク設定やファイアウォールを確認してください。")
        return
    except Exception as e:
        print(f"[エラー] 予期せぬエラー: {e}")
        return

    def send_command(cmd):
        try:
            client.send(f"{cmd}\n".encode())
            return client.recv(1024).decode().strip()
        except Exception as e:
            return f"Error: {e}"

    # 2. 基本情報の取得 (ID確認)
    model_info = send_command('_') # '_' はモデル名取得コマンド
    if model_info:
        print(f"[情報] Rigモデル: {model_info}")
    else:
        print("[警告] リグからの応答が空です。リグの電源や接続を確認してください。")

    # 3. 現在の状態確認 (周波数とモード)
    freq = send_command('f')  # get_freq
    mode_info = send_command('m')  # get_mode
    
    print(f"[現在] 周波数: {freq} Hz")
    print(f"[現在] モード: {'/'.join(mode_info.split())}")

    # 4. 書き込みテスト (現在の周波数に100Hz足して戻してみる例)
    if freq.isdigit():
        test_freq = int(freq) + 100
        print(f"[設定] 周波数を {test_freq} Hz に設定してみます...")
        set_res = send_command(f"F {test_freq}")
        
        if set_res == "RPRT 0":
            print("[制御] 周波数設定コマンドが受理されました (RPRT 0)。")
            # 元に戻す
            send_command(f"F {freq}")
        else:
            print(f"[制御] コマンドが失敗しました。レスポンス: {set_res}")
            print( "       リグが VFO モードになっているか、CAT操作を受け付ける状態か確認してください。")
    
    client.close()
    print("--- 診断終了 ---")

if __name__ == "__main__":
    # 引数があればホストとポートを指定可能
    h = sys.argv[1] if len(sys.argv) > 1 else RIGCTLD_HOST
    p = int(sys.argv[2]) if len(sys.argv) > 2 else RIGCTLD_PORT
    diagnose_rigctld(h, p)