<?php
// ============================================================================
// api/dm.php - shaxsiy (1:1) xabarlar API si
// ============================================================================
// Xabarlar serverda saqlanadi (includes/DM.php). Bu joriy foydalanuvchi
// `tg_me` (brauzerdagi MTProto) yoki PHP sessiyasi orqali aniqlanadi.
//
//   GET  ?action=threads                          -> suhbatlar ro'yxati
//   GET  ?action=messages&peer_id=N[&after_id=X]  -> suhbat xabarlari
//   POST ?action=send&peer_id=N&body=...&client_id=..
//   POST ?action=send_media&peer_id=N&kind=photo|voice  (multipart `file`)
//   POST ?action=share&peer_id=N                       (ulashilgan video karta)
//   POST ?action=read&peer_id=N                   -> o'qilgan deb belgilash
//   GET  ?action=poll&after_id=X                  -> global yangi xabarlar
//   GET  ?action=unread                           -> o'qilmaganlar soni
//   POST ?action=typing&peer_id=N                 -> "yozmoqda..." holati
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/DM.php';

$action = input('action', '', 30);
$me     = clientUserId();

// Navbadge `unread` ni tizimga kirmagan foydalanuvchi ham so'rashi mumkin -
// xato o'rniga 0 qaytaramiz (qidiruv/badge skripti jim ishlayveradi).
if ($action === 'unread' && $me <= 0) {
    ok(['unread' => 0]);
}

if ($me <= 0) {
    fail('Avval tizimga kiring', 401);
}

$dm = new DM();

switch ($action) {
    // ------------------------------------------------------------- ro'yxat
    case 'threads': {
        $threads = $dm->threads($me);
        ok([
            'threads' => $threads,
            'unread'  => $dm->unreadTotal($me),
        ]);
    }

    // ------------------------------------------------------------- xabarlar
    case 'messages': {
        $peerId  = inputInt('peer_id', 0);
        $afterId = inputInt('after_id', 0);
        $beforeId = inputInt('before_id', 0);
        if ($peerId <= 0) {
            fail('peer_id kerak');
        }
        if (!$dm->exists($peerId)) {
            fail('Foydalanuvchi topilmadi', 404);
        }
        ok([
            'messages' => $dm->messages($me, $peerId, $afterId, DM::PAGE, $beforeId),
            'typing'   => $peerId > 0 ? $dm->isTyping($me, $peerId) : false,
        ]);
    }

    // --------------------------------------------------------------- yuborish
    case 'send': {
        // Matnni `input()` (strip_tags) orqali OLMAYMIZ: chat matnida `>`/`<`
        // bo'lishi mumkin (sitata), ular saqlanib qolishi kerak. Klient
        // chiqarishda HTML-escape qiladi.
        $body = (string) ($_POST['body'] ?? $_GET['body'] ?? '');
        $peerId = inputInt('peer_id', 0);
        if ($peerId <= 0) {
            fail('peer_id kerak');
        }
        $clientId = (string) ($_POST['client_id'] ?? '');
        $r = $dm->send($me, $peerId, $body, $clientId);
        if (empty($r['ok'])) {
            fail($r['error'] ?? 'Xabar yuborilmadi', 403);
        }
        ok(['message' => $r['message'], 'duplicate' => !empty($r['duplicate'])]);
    }

    // ------------------------------------------------------------ media
    case 'send_media': {
        $peerId = inputInt('peer_id', 0);
        $kind   = input('kind', 'photo', 20);
        if ($peerId <= 0) {
            fail('peer_id kerak');
        }
        if (empty($_FILES['file']) || !is_array($_FILES['file'])) {
            fail('Fayl yuborilmadi');
        }
        $up = DM::saveUpload($me, $_FILES['file'], $kind === 'voice' ? 'voice' : 'photo');
        if (empty($up['ok'])) {
            fail($up['error'] ?? 'Faylni saqlab bo‘lmadi');
        }
        $r = $dm->sendMedia(
            $me,
            $peerId,
            $kind === 'voice' ? 'voice' : 'photo',
            $up['url'],
            $up['mime'] ?? '',
            inputInt('duration', 0),
            $up['width'] ?? 0,
            $up['height'] ?? 0,
            (string) ($_POST['caption'] ?? '')
        );
        if (empty($r['ok'])) {
            fail($r['error'] ?? 'Xabar yuborilmadi', 403);
        }
        ok(['message' => $r['message']]);
    }

    // ------------------------------------------------------- ulashilgan video
    // Chatga "reel/kino" kartasini yuborish. Fayl yuklanmaydi - video
    // Telegram kanalida qoladi, `ref` da oqim manzili saqlanadi.
    case 'share': {
        $peerId = inputInt('peer_id', 0);
        if ($peerId <= 0) {
            fail('peer_id kerak');
        }
        $r = $dm->sendShare($me, $peerId, [
            'title'    => (string) ($_POST['title'] ?? ''),
            'poster'   => (string) ($_POST['poster'] ?? ''),
            'duration' => inputInt('duration', 0),
            'type'     => input('type', '', 20),
            'id'       => inputInt('id', 0),
            'episode'  => inputInt('episode', 0),
            'channel'  => input('channel', '', 120),
            'post'     => inputInt('post', 0),
            'url'      => input('url', '', 500),
            'deep'     => input('deep', '', 500),
            'link'     => input('link', '', 500),
        ]);
        if (empty($r['ok'])) {
            fail($r['error'] ?? 'Xabar yuborilmadi', 403);
        }
        ok(['message' => $r['message']]);
    }

    // ------------------------------------------------------------ o'qilgan
    case 'read': {
        $peerId = inputInt('peer_id', 0);
        if ($peerId <= 0) {
            fail('peer_id kerak');
        }
        $dm->markRead($me, $peerId);
        ok(['read' => true, 'unread' => $dm->unreadTotal($me)]);
    }

    // ------------------------------------------------------------ poll
    case 'poll': {
        $afterId = inputInt('after_id', 0);
        ok([
            'messages' => $dm->incoming($me, $afterId, 100),
            'unread'   => $dm->unreadTotal($me),
        ]);
    }

    // ------------------------------------------------------------ unread
    case 'unread': {
        ok(['unread' => $dm->unreadTotal($me)]);
    }

    // ------------------------------------------------------------ typing
    case 'typing': {
        $peerId = inputInt('peer_id', 0);
        if ($peerId <= 0) {
            fail('peer_id kerak');
        }
        $dm->setTyping($me, $peerId);
        ok(['typing' => true]);
    }

    default:
        fail('Noma\'lum amal', 400);
}