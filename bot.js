const {
  Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  PermissionFlagsBits, ChannelType
} = require('discord.js')
const { QuickDB } = require('quick.db')
const express = require('express')

const db = new QuickDB()
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ]
})

const PREFIX = '-'
const MIN_BET = 0.25
const MAX_BET = 100
const TOKEN = process.env.DISCORD_TOKEN

const C = { GOLD: 0xf39c12, GREEN: 0x2ecc71, RED: 0xe74c3c, BLUE: 0x3498db, GREY: 0x95a5a6 }

// --- DB HELPERS ---
const getBal      = async (u, g) => (await db.get(`bal_${u}_${g}`)) || 0
const setBal      = async (u, g, v) => db.set(`bal_${u}_${g}`, Math.max(0, +parseFloat(v).toFixed(4)))
const addBal      = async (u, g, v) => setBal(u, g, (await getBal(u, g)) + v)
const subBal      = async (u, g, v) => setBal(u, g, (await getBal(u, g)) - v)
const getWager    = async (u, g) => (await db.get(`wager_${u}_${g}`)) || 0
const addWager    = async (u, g, v) => db.set(`wager_${u}_${g}`, (await getWager(u, g)) + v)
const getWagerReq = async (u, g) => (await db.get(`wagerReq_${u}_${g}`)) || 0
const addWagerReq = async (u, g, v) => db.set(`wagerReq_${u}_${g}`, (await getWagerReq(u, g)) + v)
const getRakeback = async (u, g) => (await db.get(`rakeback_${u}_${g}`)) || 0
const addRakeback = async (u, g, v) => db.set(`rakeback_${u}_${g}`, (await getRakeback(u, g)) + v * 0.01)

const recordGame = async (u, g, game, bet, profit) => {
  const s = (await db.get(`stats_${u}_${g}`)) || { wagered: 0, won: 0, lost: 0, games: 0, wins: 0, losses: 0 }
  s.wagered += bet; s.games++
  if (profit > 0) { s.won += profit; s.wins++ } else { s.lost += Math.abs(profit); s.losses++ }
  await db.set(`stats_${u}_${g}`, s)
  const hist = (await db.get(`hist_${u}_${g}`)) || []
  hist.unshift({ game, bet, profit, t: Date.now() })
  if (hist.length > 20) hist.pop()
  await db.set(`hist_${u}_${g}`, hist)
  await addWager(u, g, bet)
  await addRakeback(u, g, bet)
  // affiliate 1% earnings
  const affCode = await db.get(`affJoined_${u}_${g}`)
  if (affCode) {
    const ownerId = await db.get(`affOwner_${affCode}`)
    if (ownerId) {
      const aff = (await db.get(`affStats_${ownerId}_${g}`)) || { referrals: 0, earnings: 0 }
      aff.earnings += bet * 0.01
      await db.set(`affStats_${ownerId}_${g}`, aff)
      await addBal(ownerId, g, bet * 0.01)
    }
  }
}

const parseBet = async (str, u, g) => {
  const a = parseFloat(str)
  if (isNaN(a) || a <= 0) return { error: 'Invalid amount.' }
  if (a < MIN_BET) return { error: `Minimum bet is **$${MIN_BET}**.` }
  if (a > MAX_BET) return { error: `Maximum bet is **$${MAX_BET}**.` }
  const bal = await getBal(u, g)
  if (bal < a) return { error: `Insufficient balance. You have **$${bal.toFixed(2)}**.` }
  return { amount: a }
}

const errE = (msg) => new EmbedBuilder().setColor(C.RED).setDescription(`❌ ${msg}`)
const okE  = (t, d) => new EmbedBuilder().setColor(C.GREEN).setTitle(t).setDescription(d)

const activeGames = new Set()

// --- READY ---
client.once('ready', () => {
  console.log(`Casino bot online: ${client.user.tag}`)
  client.user.setActivity('-help | Casino', { type: 0 })
})

// --- MESSAGE HANDLER ---
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return
  const args   = message.content.slice(PREFIX.length).trim().split(/\s+/)
  const cmd    = args.shift().toLowerCase()
  const { author, guild, channel, member } = message
  if (!guild) return
  const uid = author.id
  const gid = guild.id

  // -- HELP --
  if (cmd === 'help' || cmd === 'cmds') {
    const embed = new EmbedBuilder()
      .setColor(C.GOLD)
      .setTitle('🎰 Casino Bot')
      .setDescription(
        'Select a category below to get started.\n\n' +
        'Use the dropdown menu to explore all available features.\n\n' +
        '**Games**\nDice, Blackjack, Mines\nTowers, Coinflip, Baccarat\nCup, Slots, Wheel\n\n' +
        '**Money**\nDeposits, Withdrawals\nTips, Balance\n\n' +
        '**Rewards**\nRakeback, Affiliates\nPromo Codes, Races\nDaily Lottery'
      )
      .setFooter({ text: 'Min $0.25 | Max $100 | 1% Rakeback' })
    const menu = new StringSelectMenuBuilder()
      .setCustomId('casino_help_select')
      .setPlaceholder('Choose a category...')
      .addOptions([
        { label: 'Games',            value: 'games',      emoji: '🎮', description: 'All available casino games' },
        { label: 'Money',            value: 'money',      emoji: '💰', description: 'Deposits, withdrawals, tips' },
        { label: 'Balance & Stats',  value: 'stats',      emoji: '📊', description: 'Balance, stats, leaderboard' },
        { label: 'Rewards & Promos', value: 'rewards',    emoji: '🎁', description: 'Rakeback, promo codes, races' },
        { label: 'Affiliates',       value: 'affiliates', emoji: '🤝', description: 'Affiliate system' },
        { label: 'Rules & Info',     value: 'rules',      emoji: '⚠️', description: 'Rules, limits, house edge' },
        { label: 'Private Channels', value: 'private',    emoji: '🔒', description: 'Create your own channel' },
      ])
    return message.channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] })
  }

  // -- BALANCE --
  if (cmd === 'balance' || cmd === 'bal') {
    const target = message.mentions.users.first() || author
    const [bal, wager, wagerReq] = await Promise.all([getBal(target.id, gid), getWager(target.id, gid), getWagerReq(target.id, gid)])
    return message.channel.send({ embeds: [new EmbedBuilder().setColor(C.GOLD).setTitle(`💰 ${target.username}'s Balance`)
      .addFields(
        { name: 'Balance',       value: `**$${bal.toFixed(2)}**`,                             inline: true },
        { name: 'Total Wagered', value: `$${wager.toFixed(2)}`,                               inline: true },
        { name: 'Wager Req',     value: `$${Math.max(0, wagerReq - wager).toFixed(2)} left`,  inline: true },
      ).setTimestamp()] })
  }

  // -- STATS --
  if (cmd === 'stats') {
    const target = message.mentions.users.first() || author
    const s = (await db.get(`stats_${target.id}_${gid}`)) || { wagered: 0, won: 0, lost: 0, games: 0, wins: 0, losses: 0 }
    return message.channel.send({ embeds: [new EmbedBuilder().setColor(C.BLUE).setTitle(`📊 ${target.username}'s Stats`)
      .addFields(
        { name: '🎮 Games',   value: `${s.games}`,                                                  inline: true },
        { name: '✅ Wins',    value: `${s.wins}`,                                                   inline: true },
        { name: '❌ Losses',  value: `${s.losses}`,                                                 inline: true },
        { name: '💸 Wagered', value: `$${(s.wagered||0).toFixed(2)}`,                              inline: true },
        { name: '🤑 Won',     value: `$${(s.won||0).toFixed(2)}`,                                  inline: true },
        { name: '📉 Lost',    value: `$${(s.lost||0).toFixed(2)}`,                                 inline: true },
        { name: '📈 Profit',  value: `$${((s.won||0)-(s.lost||0)).toFixed(2)}`,                    inline: true },
        { name: '🏆 Win Rate',value: s.games > 0 ? `${((s.wins/s.games)*100).toFixed(1)}%` : 'N/A', inline: true },
      ).setTimestamp()] })
  }

  // -- WAGER --
  if (cmd === 'wager') {
    const [w, wr] = await Promise.all([getWager(uid, gid), getWagerReq(uid, gid)])
    return message.channel.send({ embeds: [new EmbedBuilder().setColor(C.BLUE).setTitle('📈 Wager Stats')
      .addFields(
        { name: 'Total Wagered', value: `$${w.toFixed(2)}`,                inline: true },
        { name: 'Required',      value: `$${wr.toFixed(2)}`,               inline: true },
        { name: 'Remaining',     value: `$${Math.max(0,wr-w).toFixed(2)}`, inline: true },
      )] })
  }

  // -- HISTORY --
  if (cmd === 'history') {
    const hist = (await db.get(`hist_${uid}_${gid}`)) || []
    if (!hist.length) return message.reply({ embeds: [errE('No game history yet.')] })
    const lines = hist.slice(0, 10).map((h, i) => `${i+1}. **${h.game}** | $${h.bet.toFixed(2)} | ${h.profit>=0?'+':''}$${h.profit.toFixed(2)}`)
    return message.channel.send({ embeds: [new EmbedBuilder().setColor(C.BLUE).setTitle('📋 Recent Games').setDescription(lines.join('\n'))] })
  }

  // -- LEADERBOARD --
  if (cmd === 'leaderboard' || cmd === 'lb') {
    const all = await db.all()
    const data = all.filter(d => d.id.startsWith('wager_') && d.id.endsWith(`_${gid}`))
      .sort((a, b) => b.value - a.value).slice(0, 10)
    if (!data.length) return message.reply({ embeds: [errE('No data yet.')] })
    const lines = await Promise.all(data.map(async (d, i) => {
      const uid2 = d.id.replace('wager_','').replace(`_${gid}`,'')
      let name = uid2; try { const u = await client.users.fetch(uid2); name = u.username } catch {}
      return `${i+1}. **${name}** — $${d.value.toFixed(2)}`
    }))
    return message.channel.send({ embeds: [new EmbedBuilder().setColor(C.GOLD).setTitle('🏆 Wager Leaderboard').setDescription(lines.join('\n'))] })
  }

  // -- RACEINFO --
  if (cmd === 'raceinfo') {
    const all = await db.all()
    const data = all.filter(d => d.id.startsWith('wager_') && d.id.endsWith(`_${gid}`))
      .sort((a, b) => b.value - a.value).slice(0, 5)
    const lines = await Promise.all(data.map(async (d, i) => {
      const uid2 = d.id.replace('wager_','').replace(`_${gid}`,'')
      let name = uid2; try { const u = await client.users.fetch(uid2); name = u.username } catch {}
      return `${i+1}. **${name}** — $${d.value.toFixed(2)}`
    }))
    return message.channel.send({ embeds: [new EmbedBuilder().setColor(C.GOLD).setTitle('🏁 Wager Race Standings')
      .setDescription(lines.join('\n') || 'No participants yet.')
      .setFooter({ text: 'Top wagerers win prizes • Prizes auto-distributed' })] })
  }

  // -- DEPOSIT --
  if (cmd === 'deposit') {
    const addr = (await db.get('casino_ltc_address')) || 'Not configured — ask admin to run `-setltc <address>`'
    return message.reply({ embeds: [new EmbedBuilder().setColor(C.GOLD).setTitle('📥 Deposit LTC')
      .setDescription(
        `Send Litecoin to the address below:\n\`\`\`${addr}\`\`\`\n` +
        '• Address monitored — contact admin after sending\n' +
        '• Balance credited manually by admin\n' +
        '• Min deposit: $1.00\n\n' +
        '⚠️ All deposits require **100% wager** before withdrawal.'
      ).setTimestamp()] })
  }

  // -- WITHDRAW --
  if (cmd === 'withdraw') {
    const amount = parseFloat(args[0]); const addr = args[1]
    if (isNaN(amount) || !addr) return message.reply({ embeds: [errE('Usage: `-withdraw <amount> <LTC_address>`')] })
    const bal = await getBal(uid, gid)
    if (bal < amount) return message.reply({ embeds: [errE(`Insufficient balance. You have **$${bal.toFixed(2)}**.`)] })
    const [w, wr] = await Promise.all([getWager(uid, gid), getWagerReq(uid, gid)])
    const rem = Math.max(0, wr - w)
    if (rem > 0) return message.reply({ embeds: [errE(`Must wager **$${rem.toFixed(2)}** more before withdrawing.`)] })
    return message.reply({ embeds: [new EmbedBuilder().setColor(C.GOLD).setTitle('📤 Withdrawal Request')
      .setDescription(`**Amount:** $${amount.toFixed(2)}\n**Address:** \`${addr}\`\n\nRequest submitted. An admin will process it shortly.`).setTimestamp()] })
  }

  // -- TIP --
  if (cmd === 'tip') {
    const target = message.mentions.users.first(); const amount = parseFloat(args[1])
    if (!target || isNaN(amount) || amount <= 0) return message.reply({ embeds: [errE('Usage: `-tip @user <amount>`')] })
    if (target.id === uid) return message.reply({ embeds: [errE('Cannot tip yourself.')] })
    const bal = await getBal(uid, gid)
    if (bal < amount) return message.reply({ embeds: [errE('Insufficient balance.')] })
    await subBal(uid, gid, amount)
    await addBal(target.id, gid, amount)
    await addWagerReq(target.id, gid, amount)
    return message.reply({ embeds: [okE('💸 Tip Sent', `Tipped **$${amount.toFixed(2)}** to ${target}!`)] })
  }

  // -- RAKEBACK --
  if (cmd === 'rakeback') {
    const rb = await getRakeback(uid, gid)
    if (rb < 0.01) return message.reply({ embeds: [errE(`Not enough rakeback to claim (min $0.01). Current: **$${rb.toFixed(4)}**.`)] })
    await addBal(uid, gid, rb)
    await db.set(`rakeback_${uid}_${gid}`, 0)
    return message.reply({ embeds: [okE('💎 Rakeback Claimed!', `Claimed **$${rb.toFixed(4)}** in rakeback.`)] })
  }

  // -- REDEEM --
  if (cmd === 'redeem') {
    const code = args[0]?.toUpperCase()
    if (!code) return message.reply({ embeds: [errE('Usage: `-redeem <CODE>`')] })
    const codeData = await db.get(`promoCode_${code}`)
    if (!codeData) return message.reply({ embeds: [errE('❌ Invalid promo code.')] })
    if (await db.get(`promoUsed_${code}_${uid}`)) return message.reply({ embeds: [errE('❌ You already used this code.')] })
    if (codeData.maxUses && codeData.uses >= codeData.maxUses) return message.reply({ embeds: [errE('❌ This code has reached its maximum uses.')] })
    await addBal(uid, gid, codeData.amount)
    await addWagerReq(uid, gid, codeData.amount)
    await db.set(`promoUsed_${code}_${uid}`, true)
    await db.set(`promoCode_${code}`, { ...codeData, uses: (codeData.uses||0)+1 })
    return message.reply({ embeds: [okE('🎁 Code Redeemed!', `Added **$${codeData.amount.toFixed(2)}** to your balance!`)] })
  }

  // -- AFFILIATE COMMANDS --
  if (cmd === 'createaffiliate') {
    const code = args[0]?.toUpperCase()
    if (!code || code.length < 3 || code.length > 15) return message.reply({ embeds: [errE('Usage: `-createaffiliate <CODE>` (3–15 chars)')] })
    if (await db.get(`affCode_${uid}_${gid}`)) return message.reply({ embeds: [errE(`You already have a code. Use \`-changeaff\` to change it.`)] })
    if (await db.get(`affOwner_${code}`)) return message.reply({ embeds: [errE('That code is already taken.')] })
    await db.set(`affCode_${uid}_${gid}`, code)
    await db.set(`affOwner_${code}`, uid)
    await db.set(`affStats_${uid}_${gid}`, { referrals: 0, earnings: 0 })
    return message.reply({ embeds: [okE('✅ Affiliate Created', `Your code: **${code}**`)] })
  }

  if (cmd === 'changeaff') {
    const newCode = args[0]?.toUpperCase()
    if (!newCode) return message.reply({ embeds: [errE('Usage: `-changeaff <NEWCODE>`')] })
    const oldCode = await db.get(`affCode_${uid}_${gid}`)
    if (!oldCode) return message.reply({ embeds: [errE('You don\'t have an affiliate code yet.')] })
    const taken = await db.get(`affOwner_${newCode}`)
    if (taken && taken !== uid) return message.reply({ embeds: [errE('That code is already taken.')] })
    await db.delete(`affOwner_${oldCode}`)
    await db.set(`affCode_${uid}_${gid}`, newCode)
    await db.set(`affOwner_${newCode}`, uid)
    return message.reply({ embeds: [okE('✅ Code Changed', `New code: **${newCode}**`)] })
  }

  if (cmd === 'affiliate') {
    const code  = await db.get(`affCode_${uid}_${gid}`)
    const stats = (await db.get(`affStats_${uid}_${gid}`)) || { referrals: 0, earnings: 0 }
    return message.channel.send({ embeds: [new EmbedBuilder().setColor(C.GOLD).setTitle('🤝 Affiliate Stats')
      .addFields(
        { name: 'Your Code', value: code ? `**${code}**` : 'None — use `-createaffiliate`', inline: false },
        { name: 'Referrals', value: `${stats.referrals}`, inline: true },
        { name: 'Earnings',  value: `$${stats.earnings.toFixed(2)}`, inline: true },
      )] })
  }

  if (cmd === 'join') {
    const code = args[0]?.toUpperCase()
    if (!code) return message.reply({ embeds: [errE('Usage: `-join <CODE>`')] })
    const ownerId = await db.get(`affOwner_${code}`)
    if (!ownerId) return message.reply({ embeds: [errE('Invalid affiliate code.')] })
    if (ownerId === uid) return message.reply({ embeds: [errE('Cannot use your own code.')] })
    if (await db.get(`affJoined_${uid}_${gid}`)) return message.reply({ embeds: [errE('You already used an affiliate code.')] })
    await db.set(`affJoined_${uid}_${gid}`, code)
    const s = (await db.get(`affStats_${ownerId}_${gid}`)) || { referrals: 0, earnings: 0 }
    s.referrals++
    await db.set(`affStats_${ownerId}_${gid}`, s)
    return message.reply({ embeds: [okE('✅ Joined!', `You joined with code **${code}**!`)] })
  }

  // -- LOTTERY --
  if (cmd === 'lottery') {
    const tickets = (await db.get(`lottery_${uid}_${gid}`)) || 0
    const pot     = (await db.get(`lottery_pot_${gid}`)) || 0
    const next    = (await db.get(`lottery_next_${gid}`)) || (Date.now() + 86400000)
    return message.channel.send({ embeds: [new EmbedBuilder().setColor(C.GOLD).setTitle('🎟️ Daily Lottery')
      .setDescription(
        `**Your Tickets:** ${tickets}\n**Current Pot:** $${pot.toFixed(2)}\n**Next Draw:** <t:${Math.floor(next/1000)}:R>\n\n` +
        `Buy tickets with \`-buyticket <amount>\` — $1 each\nMore tickets = higher chance of winning!\nHouse takes 1% of the pot.`
      )] })
  }

  if (cmd === 'buyticket') {
    const n = parseInt(args[0])
    if (isNaN(n) || n < 1) return message.reply({ embeds: [errE('Usage: `-buyticket <amount>` ($1 each)')] })
    const bal = await getBal(uid, gid)
    if (bal < n) return message.reply({ embeds: [errE(`Insufficient balance. Costs **$${n}.00**.`)] })
    await subBal(uid, gid, n)
    const curr = (await db.get(`lottery_${uid}_${gid}`)) || 0
    await db.set(`lottery_${uid}_${gid}`, curr + n)
    const pot = (await db.get(`lottery_pot_${gid}`)) || 0
    await db.set(`lottery_pot_${gid}`, pot + n)
    const parts = (await db.get(`lottery_parts_${gid}`)) || []
    if (!parts.includes(uid)) { parts.push(uid); await db.set(`lottery_parts_${gid}`, parts) }
    return message.reply({ embeds: [okE('🎟️ Tickets Purchased', `Bought **${n}** ticket(s) for **$${n}.00**!`)] })
  }

  // -- PRIVATE CHANNELS --
  if (cmd === 'createprivate') {
    const bal = await getBal(uid, gid)
    if (bal < 10) return message.reply({ embeds: [errE('Need at least **$10.00** balance to create a private channel.')] })
    const existing = await db.get(`private_${uid}_${gid}`)
    if (existing) return message.reply({ embeds: [errE(`You already have a private channel: <#${existing}>`)] })
    const cat = guild.channels.cache.find(c => c.name.toLowerCase().includes('high roller') && c.type === ChannelType.GuildCategory)
    const ch = await guild.channels.create({
      name: `private-${author.username}`,
      type: ChannelType.GuildText,
      parent: cat || null,
      permissionOverwrites: [
        { id: guild.id,       allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
        { id: uid,            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
      ]
    })
    await db.set(`private_${uid}_${gid}`, ch.id)
    return message.reply({ embeds: [okE('🔒 Private Channel Created', `Your channel: ${ch}`)] })
  }

  if (cmd === 'privateadd') {
    const chId = await db.get(`private_${uid}_${gid}`)
    if (!chId) return message.reply({ embeds: [errE('You don\'t have a private channel.')] })
    const t = message.mentions.members.first()
    if (!t) return message.reply({ embeds: [errE('Usage: `-privateadd @user`')] })
    const ch = guild.channels.cache.get(chId)
    if (!ch) return message.reply({ embeds: [errE('Channel not found.')] })
    await ch.permissionOverwrites.create(t, { ViewChannel: true, SendMessages: true })
    return message.reply({ embeds: [okE('✅ User Added', `${t.user.username} can now type in your channel.`)] })
  }

  if (cmd === 'privateremove') {
    const chId = await db.get(`private_${uid}_${gid}`)
    if (!chId) return message.reply({ embeds: [errE('You don\'t have a private channel.')] })
    const t = message.mentions.members.first()
    if (!t) return message.reply({ embeds: [errE('Usage: `-privateremove @user`')] })
    const ch = guild.channels.cache.get(chId)
    if (!ch) return message.reply({ embeds: [errE('Channel not found.')] })
    await ch.permissionOverwrites.delete(t)
    return message.reply({ embeds: [okE('✅ User Removed', `${t.user.username} removed from your channel.`)] })
  }

  if (cmd === 'privatehide') {
    const chId = await db.get(`private_${uid}_${gid}`)
    if (!chId) return message.reply({ embeds: [errE('You don\'t have a private channel.')] })
    const ch = guild.channels.cache.get(chId)
    if (!ch) return message.reply({ embeds: [errE('Channel not found.')] })
    await ch.permissionOverwrites.edit(guild.id, { ViewChannel: false })
    return message.reply({ embeds: [okE('🔒 Channel Hidden', 'Hidden from non-members.')] })
  }

  if (cmd === 'privatesee') {
    const chId = await db.get(`private_${uid}_${gid}`)
    if (!chId) return message.reply({ embeds: [errE('You don\'t have a private channel.')] })
    const ch = guild.channels.cache.get(chId)
    if (!ch) return message.reply({ embeds: [errE('Channel not found.')] })
    await ch.permissionOverwrites.edit(guild.id, { ViewChannel: true, SendMessages: false })
    return message.reply({ embeds: [okE('👁️ Channel Visible', 'Visible to everyone again.')] })
  }

  // -- ADMIN COMMANDS --
  if (cmd === 'addbalance' || cmd === 'addbal') {
    if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) return message.reply({ embeds: [errE('Admin only.')] })
    const t = message.mentions.users.first(); const a = parseFloat(args[1])
    if (!t || isNaN(a)) return message.reply({ embeds: [errE('Usage: `-addbalance @user <amount>`')] })
    await addBal(t.id, gid, a)
    return message.reply({ embeds: [okE('✅ Balance Added', `Added **$${a.toFixed(2)}** to ${t.username}.`)] })
  }

  if (cmd === 'setbalance' || cmd === 'setbal') {
    if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) return message.reply({ embeds: [errE('Admin only.')] })
    const t = message.mentions.users.first(); const a = parseFloat(args[1])
    if (!t || isNaN(a)) return message.reply({ embeds: [errE('Usage: `-setbalance @user <amount>`')] })
    await setBal(t.id, gid, a)
    return message.reply({ embeds: [okE('✅ Balance Set', `${t.username}'s balance set to **$${a.toFixed(2)}**.`)] })
  }

  if (cmd === 'createcode') {
    if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) return message.reply({ embeds: [errE('Admin only.')] })
    const code = args[0]?.toUpperCase(); const amount = parseFloat(args[1]); const maxUses = parseInt(args[2]) || 1
    if (!code || isNaN(amount)) return message.reply({ embeds: [errE('Usage: `-createcode <CODE> <amount> [maxUses]`')] })
    await db.set(`promoCode_${code}`, { amount, maxUses, uses: 0 })
    return message.reply({ embeds: [okE('✅ Code Created', `Code **${code}** | $${amount.toFixed(2)} | Max uses: ${maxUses}`)] })
  }

  if (cmd === 'setltc') {
    if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) return message.reply({ embeds: [errE('Admin only.')] })
    const addr = args[0]
    if (!addr) return message.reply({ embeds: [errE('Usage: `-setltc <address>`')] })
    await db.set('casino_ltc_address', addr)
    return message.reply({ embeds: [okE('✅ LTC Address Set', `\`${addr}\``)] })
  }

  // ----------------------------- GAMES -----------------------------

  // -- COINFLIP --
  if (cmd === 'cf') {
    const bet = await parseBet(args[0], uid, gid)
    if (bet.error) return message.reply({ embeds: [errE(bet.error)] })
    const pick = args[1]?.toLowerCase()
    if (!['h', 't', 'heads', 'tails'].includes(pick||'')) return message.reply({ embeds: [errE('Usage: `-cf <amount> <h|t>`')] })
    if (activeGames.has(uid)) return message.reply({ embeds: [errE('Finish your current game first.')] })
    activeGames.add(uid)
    try {
      const heads = Math.random() < 0.5
      const pickedH = pick.startsWith('h')
      const win = heads === pickedH
      const payout = win ? bet.amount * 1.95 : 0
      const profit = payout - bet.amount
      await subBal(uid, gid, bet.amount)
      if (win) await addBal(uid, gid, payout)
      await recordGame(uid, gid, 'Coinflip', bet.amount, profit)
      return message.channel.send({ embeds: [new EmbedBuilder()
        .setColor(win ? C.GREEN : C.RED).setTitle('🪙 Coinflip')
        .setDescription(
          `You picked **${pickedH?'Heads 🪙':'Tails 🌙'}** | Result: **${heads?'Heads 🪙':'Tails 🌙'}**\n\n` +
          `Bet: **$${bet.amount.toFixed(2)}** | ${win?`✅ Won **$${payout.toFixed(2)}**`:`❌ Lost **$${bet.amount.toFixed(2)}**`}`
        )] })
    } finally { activeGames.delete(uid) }
  }

  // -- DICE --
  if (cmd === 'dice' || cmd === 'roll') {
    const bet = await parseBet(args[0], uid, gid)
    if (bet.error) return message.reply({ embeds: [errE(bet.error)] })
    if (activeGames.has(uid)) return message.reply({ embeds: [errE('Finish your current game first.')] })
    activeGames.add(uid)
    try {
      const p = Math.floor(Math.random()*100)+1, b2 = Math.floor(Math.random()*100)+1
      const win = p > b2, tie = p === b2
      const payout = win ? bet.amount*1.95 : tie ? bet.amount : 0
      const profit = payout - bet.amount
      await subBal(uid, gid, bet.amount)
      await addBal(uid, gid, payout)
      await recordGame(uid, gid, 'Dice', bet.amount, profit)
      return message.channel.send({ embeds: [new EmbedBuilder()
        .setColor(win?C.GREEN:tie?C.GOLD:C.RED).setTitle('🎲 Dice')
        .setDescription(
          `You rolled: **${p}** | Bot rolled: **${b2}**\n\n` +
          (win?`✅ Won **$${payout.toFixed(2)}**`:tie?`🤝 Tie — bet returned`:`❌ Lost **$${bet.amount.toFixed(2)}**`)
        )] })
    } finally { activeGames.delete(uid) }
  }

  // -- BACCARAT --
  if (cmd === 'bacc') {
    const bet = await parseBet(args[0], uid, gid)
    if (bet.error) return message.reply({ embeds: [errE(bet.error)] })
    const side = args[1]?.toLowerCase()
    if (!['p','b','t','player','banker','tie'].includes(side||'')) return message.reply({ embeds: [errE('Usage: `-bacc <amount> <p|b|t>`')] })
    if (activeGames.has(uid)) return message.reply({ embeds: [errE('Finish your current game first.')] })
    activeGames.add(uid)
    try {
      const card = () => Math.min(10, Math.floor(Math.random()*13)+1)
      const hval = (h) => h.reduce((s,c)=>s+c,0)%10
      const pc = [card(),card()], bc = [card(),card()]
      let pv = hval(pc), bv = hval(bc)
      if (pv<8&&bv<8) {
        if (pv<=5){pc.push(card()); pv=hval(pc)}
        if (bv<=5){bc.push(card()); bv=hval(bc)}
      }
      const result = pv>bv?'player':bv>pv?'banker':'tie'
      const picked = side.startsWith('p')?'player':side.startsWith('b')?'banker':'tie'
      const win = picked===result
      const payout = win ? (picked==='tie' ? bet.amount*9 : bet.amount*1.95) : 0
      const profit = payout - bet.amount
      await subBal(uid, gid, bet.amount)
      if (win) await addBal(uid, gid, payout)
      await recordGame(uid, gid, 'Baccarat', bet.amount, profit)
      return message.channel.send({ embeds: [new EmbedBuilder()
        .setColor(win?C.GREEN:C.RED).setTitle('🎴 Baccarat')
        .setDescription(
          `**Player:** ${pc.join(' ')} = **${pv}** | **Banker:** ${bc.join(' ')} = **${bv}**\n` +
          `Result: **${result.toUpperCase()}** | You picked: **${picked.toUpperCase()}**\n\n` +
          (win?`✅ Won **$${payout.toFixed(2)}**`:`❌ Lost **$${bet.amount.toFixed(2)}**`)
        )] })
    } finally { activeGames.delete(uid) }
  }

  // -- CUP --
  if (cmd === 'cup') {
    const bet = await parseBet(args[0], uid, gid)
    if (bet.error) return message.reply({ embeds: [errE(bet.error)] })
    const cups = Math.min(5, Math.max(3, parseInt(args[1])||3))
    if (activeGames.has(uid)) return message.reply({ embeds: [errE('Finish your current game first.')] })
    activeGames.add(uid)
    try {
      const ballPos = Math.floor(Math.random()*cups)
      const multMap = { 3:2.93, 4:3.9, 5:4.88 }
      const mult = multMap[cups]
      const row = new ActionRowBuilder().addComponents(
        ...Array.from({length:cups},(_,i)=>new ButtonBuilder().setCustomId(`cup_${i}_${uid}`).setLabel(`Cup ${i+1}`).setStyle(ButtonStyle.Primary))
      )
      const embed = () => new EmbedBuilder().setColor(C.GOLD).setTitle('🫙 Cup Game')
        .setDescription(`**${cups} cups** | Payout: **${mult}x** | Bet: **$${bet.amount.toFixed(2)}**\n\nWhich cup hides the ball?`)
      const msg = await message.channel.send({ embeds: [embed()], components: [row] })
      const i = await msg.awaitMessageComponent({ filter: i=>i.customId.startsWith(`cup_`)&&i.customId.endsWith(`_${uid}`)&&i.user.id===uid, time:30000 }).catch(()=>null)
      if (!i) {
        await msg.edit({ embeds: [embed().setColor(C.GREY).setDescription('⏰ Timed out — bet returned.')], components: [] })
        return
      }
      const pick = parseInt(i.customId.split('_')[1])
      const win = pick === ballPos
      const payout = win ? bet.amount*mult : 0
      const profit = payout - bet.amount
      await subBal(uid, gid, bet.amount)
      if (win) await addBal(uid, gid, payout)
      await recordGame(uid, gid, 'Cup', bet.amount, profit)
      const cups_display = Array.from({length:cups},(_,k)=>k===ballPos?'🫙⚽':'🫙').join(' ')
      await i.update({ embeds: [new EmbedBuilder().setColor(win?C.GREEN:C.RED).setTitle('🫙 Cup Game')
        .setDescription(`${cups_display}\n\nBall was under **Cup ${ballPos+1}** | You picked **Cup ${pick+1}**\n\n`+
          (win?`✅ Won **$${payout.toFixed(2)}**!`:`❌ Lost **$${bet.amount.toFixed(2)}**`))], components: [] })
    } finally { activeGames.delete(uid) }
  }

  // -- SLOTS --
  if (cmd === 'slots') {
    const bet = await parseBet(args[0], uid, gid)
    if (bet.error) return message.reply({ embeds: [errE(bet.error)] })
    if (activeGames.has(uid)) return message.reply({ embeds: [errE('Finish your current game first.')] })
    activeGames.add(uid)
    try {
      const syms = ['🍒','🍋','🍊','⭐','💎','7️⃣']
      const wgts = [30,25,20,15,7,3]
      const spin = () => { let r=Math.random()*100,c=0; for(let i=0;i<syms.length;i++){c+=wgts[i];if(r<c)return syms[i]} return syms[0] }
      const reels = [spin(),spin(),spin()]
      const multMap = {'🍒':1.5,'🍋':2,'🍊':3,'⭐':5,'💎':8,'7️⃣':10}
      let mult = 0
      if (reels[0]===reels[1]&&reels[1]===reels[2]) mult = multMap[reels[0]]
      else if (reels[0]===reels[1]||reels[1]===reels[2]) mult = 0.5
      const payout = mult > 0 ? bet.amount*mult : 0
      const profit = payout - bet.amount
      await subBal(uid, gid, bet.amount)
      if (mult>0) await addBal(uid, gid, payout)
      await recordGame(uid, gid, 'Slots', bet.amount, profit)
      return message.channel.send({ embeds: [new EmbedBuilder()
        .setColor(mult>=5?0xffd700:mult>0?C.GREEN:C.RED).setTitle('🎰 Slots')
        .setDescription(
          `┌───────────────┐\n│  ${reels.join('  ')}  │\n└───────────────┘\n\n` +
          (mult>=10?'🎉 **JACKPOT!** ':mult>=5?'🌟 **BIG WIN!** ':'') +
          (mult>0?`✅ **${mult}x** — Won **$${payout.toFixed(2)}**`:`❌ Lost **$${bet.amount.toFixed(2)}**`)
        )] })
    } finally { activeGames.delete(uid) }
  }

  // -- WHEEL --
  if (cmd === 'wheel') {
    const bet = await parseBet(args[0], uid, gid)
    if (bet.error) return message.reply({ embeds: [errE(bet.error)] })
    if (activeGames.has(uid)) return message.reply({ embeds: [errE('Finish your current game first.')] })
    activeGames.add(uid)
    try {
      const segs = [
        {label:'0x ❌',mult:0,w:35},{label:'0.5x 🟠',mult:0.5,w:20},
        {label:'1.5x 🟡',mult:1.5,w:20},{label:'2x 🟢',mult:2,w:15},
        {label:'3x 🔵',mult:3,w:7},{label:'5x 🟣',mult:5,w:3},
      ]
      const total = segs.reduce((s,sg)=>s+sg.w,0)
      let r = Math.random()*total, cum = 0, landed = segs[0]
      for (const sg of segs) { cum+=sg.w; if(r<cum){landed=sg;break} }
      const payout = bet.amount*landed.mult
      const profit = payout - bet.amount
      await subBal(uid, gid, bet.amount)
      if (landed.mult>0) await addBal(uid, gid, payout)
      await recordGame(uid, gid, 'Wheel', bet.amount, profit)
      return message.channel.send({ embeds: [new EmbedBuilder()
        .setColor(landed.mult>1?C.GREEN:landed.mult===0?C.RED:C.GOLD).setTitle('🎡 Wheel')
        .setDescription(
          segs.map(s=>s.label===landed.label?`**[${s.label}]**`:s.label).join(' | ') + '\n\n' +
          `Landed: **${landed.label}**\n` +
          (landed.mult>0?`✅ Won **$${payout.toFixed(2)}** (${landed.mult}x)`:`❌ Lost **$${bet.amount.toFixed(2)}**`)
        )] })
    } finally { activeGames.delete(uid) }
  }

  // -- BLACKJACK --
  if (cmd === 'bj') {
    const bet = await parseBet(args[0], uid, gid)
    if (bet.error) return message.reply({ embeds: [errE(bet.error)] })
    if (activeGames.has(uid)) return message.reply({ embeds: [errE('Finish your current game first.')] })
    activeGames.add(uid)
    try {
      const deck = []
      for (const s of ['♠','♥','♦','♣']) for (const r of ['A','2','3','4','5','6','7','8','9','10','J','Q','K']) deck.push(`${r}${s}`)
      for (let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]]}
      let di=0; const draw=()=>deck[di++]
      const cval = c=>{const r=c.slice(0,-1);if(r==='A')return 11;if(['J','Q','K'].includes(r))return 10;return parseInt(r)}
      const hval = h=>{let v=h.reduce((s,c)=>s+cval(c),0),a=h.filter(c=>c.startsWith('A')).length;while(v>21&&a>0){v-=10;a--};return v}
      const ph=[draw(),draw()], dh=[draw(),draw()]
      let betAmt = bet.amount
      await subBal(uid, gid, betAmt)
      const makeE = (done=false, res=null)=>new EmbedBuilder()
        .setColor(res==='win'||res==='bj'?C.GREEN:res==='lose'?C.RED:res==='push'?C.GOLD:C.BLUE).setTitle('🃏 Blackjack')
        .setDescription(
          `**Dealer:** ${done?dh.join(' '):`${dh[0]} 🂠 `} (${done?hval(dh):cval(dh[0])})\n` +
          `**You:** ${ph.join(' ')} (${hval(ph)})\n**Bet:** $${betAmt.toFixed(2)}\n\n` +
          (res==='win'?`✅ You win! +$${(betAmt*1.95-betAmt).toFixed(2)}`:
           res==='bj'?`🎉 Blackjack! +$${(betAmt*2.5-betAmt).toFixed(2)}`:
           res==='lose'?`❌ You lose! -$${betAmt.toFixed(2)}`:
           res==='push'?`🤝 Push — bet returned`:
           'What would you like to do?')
        )
      const makeR = (dis=false)=>new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bj_hit_${uid}`).setLabel('Hit').setStyle(ButtonStyle.Primary).setDisabled(dis),
        new ButtonBuilder().setCustomId(`bj_stand_${uid}`).setLabel('Stand').setStyle(ButtonStyle.Secondary).setDisabled(dis),
        new ButtonBuilder().setCustomId(`bj_double_${uid}`).setLabel('Double').setStyle(ButtonStyle.Danger).setDisabled(dis||ph.length>2),
      )
      if (hval(ph)===21) {
        const dealerBJ = hval(dh)===21
        const profit = dealerBJ ? 0 : betAmt*1.5
        await addBal(uid, gid, dealerBJ ? betAmt : betAmt+profit)
        await recordGame(uid, gid, 'Blackjack', betAmt, dealerBJ?0:profit)
        return message.channel.send({ embeds: [makeE(true, dealerBJ?'push':'bj')], components: [] })
      }
      const msg = await message.channel.send({ embeds: [makeE()], components: [makeR()] })
      const filt = i=>i.customId.startsWith('bj_')&&i.customId.endsWith(`_${uid}`)&&i.user.id===uid
      const endG = async (res, interaction) => {
        let profit=0
        if (res==='win'||res==='bj') { const m=res==='bj'?2.5:1.95; profit=betAmt*m-betAmt; await addBal(uid,gid,betAmt*m) }
        else if (res==='push') { profit=0; await addBal(uid,gid,betAmt) }
        else profit=-betAmt
        await recordGame(uid, gid, 'Blackjack', betAmt, profit)
        activeGames.delete(uid)
        const upd=interaction?interaction.update.bind(interaction):msg.edit.bind(msg)
        await upd({ embeds:[makeE(true,res)], components:[] }).catch(()=>{})
      }
      const play = async () => {
        const pv=hval(ph)
        if (pv>21) { await endG('lose',null); return }
        if (pv===21) { while(hval(dh)<17)dh.push(draw()); const dv=hval(dh); await endG(dv>21||pv>dv?'win':dv>pv?'lose':'push',null); return }
        let inter; try { inter=await msg.awaitMessageComponent({filter:filt,time:60000}) } catch { await endG('lose',null); return }
        if (inter.customId===`bj_hit_${uid}`) {
          ph.push(draw())
          if (hval(ph)>21) { await endG('lose',inter) }
          else { await inter.update({embeds:[makeE()],components:[makeR()]}); await play() }
        } else if (inter.customId===`bj_stand_${uid}`) {
          while(hval(dh)<17)dh.push(draw())
          const dv=hval(dh),pv2=hval(ph)
          await endG(dv>21||pv2>dv?'win':dv>pv2?'lose':'push',inter)
        } else if (inter.customId===`bj_double_${uid}`) {
          const b=await getBal(uid,gid)
          if (b<betAmt) { await inter.reply({content:'Not enough balance to double.',ephemeral:true}); await play(); return }
          await subBal(uid,gid,betAmt); betAmt*=2; ph.push(draw())
          while(hval(dh)<17)dh.push(draw())
          const dv=hval(dh),pv2=hval(ph)
          await endG(pv2>21?'lose':dv>21||pv2>dv?'win':dv>pv2?'lose':'push',inter)
        }
      }
      await play()
    } catch(e) { activeGames.delete(uid); console.error('BJ error:',e) }
  }

  // -- MINES --
  if (cmd === 'mines') {
    const bet = await parseBet(args[0], uid, gid)
    if (bet.error) return message.reply({ embeds: [errE(bet.error)] })
    const mc = Math.min(24, Math.max(1, parseInt(args[1])||3))
    if (activeGames.has(uid)) return message.reply({ embeds: [errE('Finish your current game first.')] })
    activeGames.add(uid)
    try {
      const TOTAL=25
      const mines=new Set(); while(mines.size<mc)mines.add(Math.floor(Math.random()*TOTAL))
      const revealed=new Set(); let cashedOut=false, exploded=false
      await subBal(uid, gid, bet.amount)
      const getMult=(gems)=>{if(gems===0)return 1;let m=1;for(let i=0;i<gems;i++)m*=(TOTAL-mc-i)/(TOTAL-i);return +((1/m)*0.975).toFixed(3)}
      const makeGrid=(showAll=false)=>{
        const rows=[]
        for(let r=0;r<5;r++){
          const row=new ActionRowBuilder()
          for(let c=0;c<5;c++){
            const idx=r*5+c, isRev=revealed.has(idx), isMine=mines.has(idx)
            row.addComponents(new ButtonBuilder()
              .setCustomId(`m_${idx}_${uid}`)
              .setLabel(isRev||showAll?(isMine?'💣':'💎'):'❓')
              .setStyle(isRev?(isMine?ButtonStyle.Danger:ButtonStyle.Success):showAll&&isMine?ButtonStyle.Danger:showAll?ButtonStyle.Success:ButtonStyle.Secondary)
              .setDisabled(isRev||cashedOut||exploded||showAll))
          }
          rows.push(row)
        }
        if (!showAll) {
          const gems=revealed.size, mult=getMult(gems)
          rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setCustomId(`mc_${uid}`).setLabel(gems>0?`💰 Cashout $${(bet.amount*mult).toFixed(2)} (${mult}x)`:'💰 Cashout')
            .setStyle(ButtonStyle.Primary).setDisabled(gems===0||cashedOut||exploded)))
        }
        return rows
      }
      const makeE=(status='playing')=>new EmbedBuilder()
        .setColor(status==='cashout'?C.GREEN:status==='explode'?C.RED:C.GOLD).setTitle('💣 Mines')
        .setDescription(`Mines: **${mc}** | Gems: **${revealed.size}** | Mult: **${getMult(revealed.size)}x**\nBet: **$${bet.amount.toFixed(2)}** | Potential: **$${(bet.amount*getMult(revealed.size)).toFixed(2)}**\n\n`+
          (status==='cashout'?`✅ Cashed out **$${(bet.amount*getMult(revealed.size)).toFixed(2)}**!`:
           status==='explode'?`💥 Hit a bomb! Lost **$${bet.amount.toFixed(2)}**`:
           'Click tiles to reveal gems. Avoid mines!'))
      const msg=await message.channel.send({embeds:[makeE()],components:makeGrid()})
      const filt=i=>(i.customId.startsWith('m_')||i.customId.startsWith('mc_'))&&i.customId.endsWith(`_${uid}`)&&i.user.id===uid
      const coll=msg.createMessageComponentCollector({filter:filt,time:300000})
      coll.on('collect', async inter=>{
        if (cashedOut||exploded) return
        if (inter.customId===`mc_${uid}`) {
          if (revealed.size===0) return inter.reply({content:'Reveal at least one gem first!',ephemeral:true})
          cashedOut=true; const mult=getMult(revealed.size), win=bet.amount*mult
          await addBal(uid,gid,win); await recordGame(uid,gid,'Mines',bet.amount,win-bet.amount)
          coll.stop(); activeGames.delete(uid)
          await inter.update({embeds:[makeE('cashout')],components:makeGrid(true)}).catch(()=>{})
          return
        }
        const idx=parseInt(inter.customId.split('_')[1])
        if (isNaN(idx)||revealed.has(idx)) return
        revealed.add(idx)
        if (mines.has(idx)) {
          exploded=true; await recordGame(uid,gid,'Mines',bet.amount,-bet.amount)
          coll.stop(); activeGames.delete(uid)
          await inter.update({embeds:[makeE('explode')],components:makeGrid(true)}).catch(()=>{})
          return
        }
        if (revealed.size===TOTAL-mc) {
          cashedOut=true; const mult=getMult(revealed.size), win=bet.amount*mult
          await addBal(uid,gid,win); await recordGame(uid,gid,'Mines',bet.amount,win-bet.amount)
          coll.stop(); activeGames.delete(uid)
          await inter.update({embeds:[makeE('cashout')],components:makeGrid(true)}).catch(()=>{})
          return
        }
        await inter.update({embeds:[makeE()],components:makeGrid()}).catch(()=>{})
      })
      coll.on('end',(_,reason)=>{
        if (!cashedOut&&!exploded) {
          activeGames.delete(uid)
          addBal(uid,gid,bet.amount).catch(()=>{})
          msg.edit({embeds:[makeE().setDescription('⏰ Timed out — bet returned.')],components:[]}).catch(()=>{})
        }
      })
    } catch(e){activeGames.delete(uid);console.error('Mines error:',e)}
  }

  // -- TOWERS --
  if (cmd === 'towers') {
    const bet = await parseBet(args[0], uid, gid)
    if (bet.error) return message.reply({ embeds: [errE(bet.error)] })
    const diff = args[1]?.toLowerCase() || 'easy'
    if (!['easy','med','hard'].includes(diff)) return message.reply({ embeds: [errE('Usage: `-towers <amount> [easy/med/hard]`')] })
    if (activeGames.has(uid)) return message.reply({ embeds: [errE('Finish your current game first.')] })
    activeGames.add(uid)
    try {
      const cfgs={easy:{tiles:3,bombs:1},med:{tiles:3,bombs:2},hard:{tiles:2,bombs:1}}
      const cfg=cfgs[diff], ROWS=8
      const bombPos=Array.from({length:ROWS},()=>{const r=Array(cfg.tiles).fill(false);const b=new Set();while(b.size<cfg.bombs)b.add(Math.floor(Math.random()*cfg.tiles));b.forEach(i=>r[i]=true);return r})
      let row=0, cashedOut=false, exploded=false
      await subBal(uid, gid, bet.amount)
      const getM=(r)=>+(Math.pow(cfg.tiles/(cfg.tiles-cfg.bombs),r)*0.975).toFixed(3)
      const makeE=(status='playing')=>new EmbedBuilder()
        .setColor(status==='cashout'?C.GREEN:status==='explode'?C.RED:C.GOLD).setTitle('🗼 Towers')
        .setDescription(`Difficulty: **${diff}** | Row: **${row}/${ROWS}**\nMultiplier: **${getM(row)}x** | Payout: **$${(bet.amount*getM(row)).toFixed(2)}**\n\n`+
          (status==='cashout'?`✅ Cashed out **$${(bet.amount*getM(row)).toFixed(2)}**!`:
           status==='explode'?`💥 Hit a bomb! Lost **$${bet.amount.toFixed(2)}**`:
           status==='top'?`🏆 Reached the top! Won **$${(bet.amount*getM(row)).toFixed(2)}**!`:
           `Choose a tile on Row ${row+1}`))
      const makeR=()=>{
        if (cashedOut||exploded) return []
        const tR=new ActionRowBuilder().addComponents(...Array.from({length:cfg.tiles},(_,i)=>new ButtonBuilder().setCustomId(`t_tile_${i}_${uid}`).setLabel(`Tile ${i+1}`).setStyle(ButtonStyle.Primary)))
        const cR=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`t_cash_${uid}`)
          .setLabel(row>0?`💰 Cashout $${(bet.amount*getM(row)).toFixed(2)}`:'💰 Cashout').setStyle(ButtonStyle.Success).setDisabled(row===0))
        return [tR,cR]
      }
      const msg=await message.channel.send({embeds:[makeE()],components:makeR()})
      const filt=i=>(i.customId.startsWith('t_'))&&i.customId.endsWith(`_${uid}`)&&i.user.id===uid
      const coll=msg.createMessageComponentCollector({filter:filt,time:300000})
      coll.on('collect',async inter=>{
        if (cashedOut||exploded) return
        if (inter.customId===`t_cash_${uid}`) {
          if (row===0) return inter.reply({content:'Climb at least one row first!',ephemeral:true})
          cashedOut=true; const win=bet.amount*getM(row)
          await addBal(uid,gid,win); await recordGame(uid,gid,'Towers',bet.amount,win-bet.amount)
          coll.stop(); activeGames.delete(uid)
          await inter.update({embeds:[makeE('cashout')],components:[]}).catch(()=>{})
          return
        }
        const ti=parseInt(inter.customId.split('_')[2])
        if (bombPos[row][ti]) {
          exploded=true; await recordGame(uid,gid,'Towers',bet.amount,-bet.amount)
          coll.stop(); activeGames.delete(uid)
          await inter.update({embeds:[makeE('explode')],components:[]}).catch(()=>{})
          return
        }
        row++
        if (row>=ROWS) {
          cashedOut=true; const win=bet.amount*getM(row)
          await addBal(uid,gid,win); await recordGame(uid,gid,'Towers',bet.amount,win-bet.amount)
          coll.stop(); activeGames.delete(uid)
          await inter.update({embeds:[makeE('top')],components:[]}).catch(()=>{})
          return
        }
        await inter.update({embeds:[makeE()],components:makeR()}).catch(()=>{})
      })
      coll.on('end',(_,reason)=>{
        if (!cashedOut&&!exploded) {
          activeGames.delete(uid)
          const win=row>0?bet.amount*getM(row):bet.amount
          addBal(uid,gid,win).catch(()=>{})
          msg.edit({embeds:[makeE().setDescription('⏰ Timed out.')],components:[]}).catch(()=>{})
        }
      })
    } catch(e){activeGames.delete(uid);console.error('Towers error:',e)}
  }

  if (cmd === 'cashout') {
    return message.reply({ embeds: [errE('Use the **Cashout** button in your active game!')] })
  }
})

// --- INTERACTION HANDLER (help menu) ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isStringSelectMenu() || interaction.customId !== 'casino_help_select') return
  const sel = interaction.values[0]
  const pages = {
    games: new EmbedBuilder().setColor(C.GOLD).setTitle('🎮 All Casino Games').setDescription(
      '🎲 **DICE** `-dice <amount>`\nPvP or vs Bot | Payout: 1.95x (bot) | Edge: 2.5%\n\n' +
      '🃏 **BLACKJACK** `-bj <amount>`\nBeat dealer to 21. Hit, Stand, Double\nPayout: ~1.95x | Edge: 2.5%\n\n' +
      '💣 **MINES** `-mines <amount> [mines]`\nReveal gems, avoid bombs. Cashout anytime\nVariable payout | Edge: 2.5%\n\n' +
      '🗼 **TOWERS** `-towers <amount> [easy/med/hard]`\nClimb rows, avoid wrong tiles. Cashout anytime\nVariable payout | Edge: 2.5%\n\n' +
      '🪙 **COINFLIP** `-cf <amount> <h|t>`\nPick heads or tails and flip!\nPayout: 1.95x | Edge: 2.5%\n\n' +
      '🎴 **BACCARAT** `-bacc <amount> <p|b|t>`\nBet Player, Banker, or Tie\nPayout: 1.95x/1.95x/9x | Edge: 2.5%\n\n' +
      '🫙 **CUP** `-cup <amount> [3-5]`\nGuess which cup hides the ball\nPayout: 2.93x–4.88x | Edge: 2.5%\n\n' +
      '🎰 **SLOTS** `-slots <amount>`\nMatch 3 symbols for big wins + jackpot\nPayout: 1.5x–10x | Edge: 2.5%\n\n' +
      '🎡 **WHEEL** `-wheel <amount>`\nSpin the wheel for multipliers!\nPayout: 0.5x–5x | Edge: 2.5%\n\n' +
      '🎟️ **LOTTERY** `-lottery` | `-buyticket <n>`\n$1/ticket | Drawn every 24h | House: 1%'
    ),
    money: new EmbedBuilder().setColor(C.GREEN).setTitle('💰 Deposits & Withdrawals').setDescription(
      '📥 **DEPOSIT**\n`-deposit` — Get your LTC address\n• Send Litecoin to the address shown\n• Balance credited by admin after confirmation\n\n' +
      '📤 **WITHDRAW**\n`-withdraw <amount> <LTC_address>`\n• Must meet wager requirement first\n\n' +
      '🎁 **TIP USERS**\n`-tip @user <amount>`\n• Recipient gets wager requirement\n\n' +
      '⚠️ All deposits/tips require **100% wager** before withdrawal'
    ),
    stats: new EmbedBuilder().setColor(C.BLUE).setTitle('📊 Balance & Stats').setDescription(
      '💰 **BALANCE**\n`-balance` or `-bal` — Your balance\n`-bal @user` — Check someone else\n\n' +
      '📊 **STATISTICS**\n`-stats` — Your full stats\n`-stats @user` — Someone\'s stats\n`-wager` — Wager statistics\n\n' +
      '📋 **HISTORY**\n`-history` — Recent games\n\n' +
      '🏆 **LEADERBOARD**\n`-leaderboard` or `-lb` — Top wagerers\n\n' +
      '🏁 **WAGER RACE**\n`-raceinfo` — Current race standings'
    ),
    rewards: new EmbedBuilder().setColor(C.GOLD).setTitle('🎁 Rewards & Promos').setDescription(
      '💎 **RAKEBACK (1%)**\n`-rakeback` — Claim your earnings\n• Earn 1% back on ALL wagers\n• Accumulates automatically\n\n' +
      '🎁 **PROMO CODES**\n`-redeem <CODE>` — Redeem a code\n• One use per code per user\n\n' +
      '🏁 **WAGER RACES**\n`-raceinfo` — View current race\n• Compete for prize pools'
    ),
    affiliates: new EmbedBuilder().setColor(C.GOLD).setTitle('🤝 Affiliate System').setDescription(
      '🔑 **CREATE YOUR CODE**\n`-createaffiliate <CODE>`\n\n' +
      '✏️ **CHANGE CODE**\n`-changeaff <NEWCODE>`\n\n' +
      '📊 **VIEW STATS**\n`-affiliate` — Your referrals & earnings\n\n' +
      '🆕 **FOR NEW PLAYERS**\n`-join <CODE>` — Use someone\'s code\n\n' +
      '💰 **BENEFITS**\n• Earn 1% from referral wagers'
    ),
    rules: new EmbedBuilder().setColor(C.RED).setTitle('⚠️ Rules & Important Info').setDescription(
      '📋 **WAGER REQUIREMENTS**\n• Deposits: 100% wager before withdraw\n• Tips received: 100% wager required\n• Promo codes: 100% wager required\n\n' +
      '🎰 **HOUSE EDGE**\n• All games: 2.5%\n\n' +
      '🔒 **PRIVATE CHANNELS**\n• Need $10+ balance to create\n\n' +
      '💲 **LIMITS**\n• Min bet: $0.25\n• Max bet: $100.00'
    ),
    private: new EmbedBuilder().setColor(C.GOLD).setTitle('🔒 Private Channels').setDescription(
      '**Create your own exclusive channel in HIGH ROLLERS!**\n\n' +
      '📋 **REQUIREMENTS**\n• Need $10.00 balance to create\n• Balance is NOT deducted\n• 1 private channel per person\n\n' +
      '🛠️ **COMMANDS**\n`-createprivate` — Create your channel\n`-privateadd @user` — Let someone type\n`-privateremove @user` — Remove access\n`-privatehide` — Hide from non-members\n`-privatesee` — Make visible again'
    ),
  }
  const embed = pages[sel]
  if (!embed) return
  await interaction.reply({ embeds: [embed], ephemeral: true })
})

// --- EXPRESS HEALTH CHECK ---
const app = express()
app.get('/', (_, res) => res.send('Casino bot running ✅'))
app.listen(process.env.PORT || 3000, () => console.log('Health check server up'))

if (!TOKEN) {
  console.error('ERROR: DISCORD_TOKEN environment variable is not set!')
  process.exit(1)
}

client.login(TOKEN)
