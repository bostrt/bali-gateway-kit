# Ezlo-Hub-Kit

![Continuous Integration](https://github.com/bostrt/bali-gateway-kit/workflows/Continuous%20Integration/badge.svg)![Publish NPM Package](https://github.com/bostrt/bali-gateway-kit/workflows/Publish%20NPM%20Package/badge.svg)

## Overview

Bali-Gateway-Kit is a [Node.js Package Manager](https://www.npmjs.com) module that provides a convenient, fully-typed, SDK for Bali's Motorization Gateways. The kit enables applications to discovery connected hubs given a Bali account, connect to them, retrieve properties such as devices and rooms, observe hub events and perform hub actions.

This project is very heavily based on this project https://github.com/bblacey/ezlo-hub-kit/. This project includes customizations so it can fully function with Bali's API.

## Installation
```zsh
npm install bali-gateway-kit --save
```

`ezlo-hub-kit` is a hybrid npm module that supports both commonJS and ESM modules with complete Typescript type definitions.

<span style="color:grey">*ESM*</span></p>
```ts
import { BaliCloudResolver, BaliGateway } from 'bali-gateway-kit';
```

<span style="color:grey">*commonJS*</span>
```js
const { BaliCloudResolver, BaliGateway } = require('bali-gateway-kit');
```

## Usage

*TODO*