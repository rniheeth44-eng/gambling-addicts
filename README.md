# 🎰 Casino Discord Bot

A full-featured Discord casino bot with games, economy, affiliates, and more.

## Features

- **Games**: Dice, Blackjack, Mines, Towers, Coinflip, Baccarat, Cup, Slots, Wheel
- **Economy**: Balance, deposits (LTC), withdrawals, tips
- **Rewards**: 1% Rakeback, promo codes, wager races, daily lottery
- **Affiliates**: Referral codes with 1% earnings
- **Private Channels**: Exclusive high-roller channels
- **Admin Commands**: Add/set balance, create promo codes, set LTC address

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set your Discord bot token as an environment variable:
   ```
   DISCORD_TOKEN=your_token_here
   ```

3. Run the bot:
   ```bash
   npm start
   ```

## Commands

| Command | Description |
|---------|-------------|
| `-help` | Show help menu |
| `-bal` | Check balance |
| `-stats` | View your stats |
| `-history` | Recent game history |
| `-lb` | Wager leaderboard |
| `-deposit` | Get LTC deposit address |
| `-withdraw <amount> <address>` | Request withdrawal |
| `-tip @user <amount>` | Tip a user |
| `-rakeback` | Claim rakeback |
| `-redeem <CODE>` | Redeem promo code |
| `-dice <amount>` | Play dice |
| `-bj <amount>` | Play blackjack |
| `-cf <amount> <h/t>` | Coinflip |
| `-mines <amount> [mines]` | Mines game |
| `-towers <amount> [easy/med/hard]` | Towers game |
| `-slots <amount>` | Slots |
| `-wheel <amount>` | Spin the wheel |
| `-bacc <amount> <p/b/t>` | Baccarat |
| `-cup <amount> [3-5]` | Cup game |
| `-lottery` | View lottery info |
| `-buyticket <n>` | Buy lottery tickets |

## Admin Commands

| Command | Description |
|---------|-------------|
| `-addbalance @user <amount>` | Add balance |
| `-setbalance @user <amount>` | Set balance |
| `-createcode <CODE> <amount> [maxUses]` | Create promo code |
| `-setltc <address>` | Set LTC deposit address |

## Limits

- Min bet: $0.25
- Max bet: $100.00
- House edge: 2.5% on all games
- Rakeback: 1% on all wagers
