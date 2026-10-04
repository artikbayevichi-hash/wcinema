<?php
// ============================================================================
// api/chat.php - chat yadrosi uchun API
// ============================================================================
//   GET  ?action=rooms                 -> 4 umumiy xona (topic id bilan)
//   GET  ?action=contacts              -> shaxsiy chat ro'yxati (bloklar filtrlanadi)
//   GET  ?action=peer&peer_id=N        -> bitta foydalanuvchi (Xabar tugmasi)
//   GET  ?action=can_message&peer_id=N -> DM yuborishga ruxsat (blok tekshiruvi)
//   POST ?action=add_contact&peer_id=N -> ro'yxatga qo'shish (blokda rad etiladi)
//   POST ?action=remove_contact&peer_id=N
//
// Joriy foydalanuvchi `tg_me` orqali aniqlanadi (reelUserId) - saytda PHP
// sessiyasi yo'q, chunki kirish brauzerdagi MTProto orqali.
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/Chat.php';
require_once __DIR__ . '/../includes/Blocks.php';

$chat   = new Chat();
$action = input('action', 'rooms', 30);

switch ($action) {
    // ------------------------------------------------------------- xonalar
    case 'rooms': {
        $rooms = $chat->rooms(true);
        ok(['rooms' => $rooms, 'chat' => TG_COMMENTS_CHAT]);
    }

    // ------------------------------------------------------------- ro'yxat
    case 'contacts': {
        $uid = reelUserId();
        if ($uid <= 0) {
            fail('Avval tizimga kiring', 401);
        }
        // Bloklanganlar allaqachon `Chat::contacts()` ichida filtrlandi.
        ok(['contacts' => $chat->contacts($uid)]);
    }

    // ----------------------------------------------------------- bitta peer
    case 'peer': {
        $uid = reelUserId();
        if ($uid <= 0) {
            fail('Avval tizimga kiring', 401);
        }
        $peerId = inputInt('peer_id', 0);
        if ($peerId <= 0) {
            fail('peer_id kerak');
        }
        $p = $chat->peer($peerId, $uid);
        if (!$p) {
            fail('Foydalanuvchi topilmadi', 404);
        }
        ok(['peer' => $p]);
    }

    // --------------------------------------------------- xabar yuborish huquqi
    // Klient shu endpoint orqali DM yuborish tugmasini oldindan o'chiradi.
    case 'can_message': {
        $uid = reelUserId();
        if ($uid <= 0) {
            fail('Avval tizimga kiring', 401);
        }
        $peerId = inputInt('peer_id', 0);
        if ($peerId <= 0) {
            fail('peer_id kerak');
        }
        $p = $chat->messagePermission($uid, $peerId);
        ok([
            'ok'         => $p['ok'],
            'blocked'    => $p['blocked'],
            'i_blocked'  => $p['i_blocked'],
            'blocked_me' => $p['blocked_me'],
            'reason'     => $p['ok'] ? '' : ($p['i_blocked'] ? 'blocked_me' : 'blocked'),
        ]);
    }

    // ------------------------------------------------------ qo'shish/olib tashlash
    case 'add_contact': {
        $uid = reelUserId();
        if ($uid <= 0) {
            fail('Avval tizimga kiring', 401);
        }
        $peerId = inputInt('peer_id', 0);
        if ($peerId <= 0) {
            fail('peer_id kerak');
        }
        // Bloklangan bo'lsa aniq xabar beramiz (boshqa sabab chalkashmasin).
        $perm = $chat->messagePermission($uid, $peerId);
        if (!$perm['ok']) {
            fail($perm['i_blocked']
                ? 'Siz bu foydalanuvchini bloklagansiz'
                : 'Bu foydalanuvchi sizni bloklagan', 403);
        }
        if (!$chat->addContact($uid, $peerId)) {
            fail('Qo\'shib bo\'lmadi', 400);
        }
        ok(['peer' => $chat->peer($peerId, $uid)]);
    }

    case 'remove_contact': {
        $uid = reelUserId();
        if ($uid <= 0) {
            fail('Avval tizimga kiring', 401);
        }
        $peerId = inputInt('peer_id', 0);
        if ($peerId <= 0) {
            fail('peer_id kerak');
        }
        $chat->removeContact($uid, $peerId);
        ok(['removed' => true]);
    }

    default:
        fail('Noma\'lum amal', 400);
}
