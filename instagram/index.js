const ig = new (require('instagram-private-api')).IgApiClient()
const { IgLoginTwoFactorRequiredError, IgCheckpointError } = require('instagram-private-api')
const prx = require('socks-proxy-agent')
const Bluebird = require('bluebird')
const inquirer = require('inquirer')
const fs = require('fs')
const path = require('path')
const fetch = require('node-fetch')

const targetType = process.argv[2]
let targetLink = process.argv[3] // https://instagram.com/wow_mamita_ || girls31
const postsParseLimit = process.argv[4]
const downloadPath = process.argv[5]
const proxyType = process.argv[6]
const proxy = process.argv[7]
const IgLogin = process.argv[8]
const IgPassword = process.argv[9]
// const checkGetVideo = process.argv[10]
const urlLst = []
let postsCounter = 0
let photoCounter = 0
let videoCounter = 0
let carouselCounter = 0
let commonCounter = 0
let isCarousel = false;
// const proxyType = 1;

(async () => {
  // try {
  targetLink = targetLink.replace(/\s*/, '')
  console.log(`Парсим пользователя: ${targetLink}`)
  if (proxy != 'null') {
    if (proxyType.contains('http') || proxyType.contains('HTTP')) {
      // ig.request.defaults.agentClass = prx
      ig.state.proxyUrl = proxy
    } else if (proxyType.contains('socks') || proxyType.contains('SOCKS')) {
      ig.request.defaults.agentOptions = new prx.SocksProxyAgent(proxy)
    } else {
      throw new Error(`Неверный тип прокси: ${proxyType}`)
    }
    console.log(`Используем прокси: ${proxy}`)
  }
  await auth2FA(IgLogin, IgPassword)
  console.log('Авторизация успешна')
  // } catch (e) {
  //   throw new Error(`Ошибка при авторизации в аккаунт: ${e}`)
  // }

  // try {
  const targetId = await ig.user.getIdByUsername(targetLink)
  if (targetType == 'Группа/Пользователь') {
    await getUsrFeed(targetId)
  } else {
    await getTagFeed(targetId)
  }
  // } catch (e) {
  //   if (targetType == 'Группа/Пользователь') {
  //     throw new Error(`Ошибка при парсинге пользователя ${targetLink}: ${e}`)
  //   } else {
  //     throw new Error(`Ошибка при парсинге тега ${targetLink}: ${e}`)
  //   }
  // }
  // // Парсинг сторис
  // if (checkParseStories) {
  //   await getUsrStories(targetLink)
  // }
})()
async function auth2FA(IgLogin, IgPassword) {
  return Bluebird.try(async () => {
    ig.state.generateDevice(IgLogin);
    await ig.simulate.preLoginFlow()
    const session = await ig.account.login(IgLogin, IgPassword)
    process.nextTick(async () => await ig.simulate.postLoginFlow())
    return session
  }).catch(
    IgLoginTwoFactorRequiredError,
    async err => {
      const { username, totp_two_factor_on, two_factor_identifier } = err.response.body.two_factor_info;
      // decide which method to use
      const verificationMethod = totp_two_factor_on ? '0' : '1'; // default to 1 for SMS
      // At this point a code should have been sent
      // Get the code
      const { code } = await inquirer.prompt([
        {
          type: 'input',
          name: 'code',
          message: `Enter code received via ${verificationMethod === '1' ? 'SMS' : 'TOTP'}`,
        },
      ]);
      // Use the code to finish the login process
      return ig.account.twoFactorLogin({
        username,
        verificationCode: code,
        twoFactorIdentifier: two_factor_identifier,
        verificationMethod, // '1' = SMS (default), '0' = TOTP (google auth for example)
        trustThisDevice: '1', // Can be omitted as '1' is used by default
      });
    },
  ).catch(IgCheckpointError, async () => {
    console.log(ig.state.checkpoint); // Checkpoint info here
    await ig.challenge.auto(true); // Requesting sms-code or click "It was me" button
    console.log(ig.state.checkpoint); // Challenge info here
    const { code } = await inquirer.prompt([
      {
        type: 'input',
        name: 'code',
        message: 'Enter code',
      },
    ]);
    console.log(await ig.challenge.sendSecurityCode(code));
  }).catch(e => {
    throw new Error(`Ошибка при авторизации в аккаунт: ${e} ${e.stack}\n\nПереданные аргументы: ${process.argv}`)
  })
}
async function getUsrStories(targetLink) {
  const storiesFeed = ig.feed.userStory(targetId)
  while (true) {
    const feed = await storiesFeed.items()
    for (let i = 0; i < feed.length; i++) {
      await parseJSONRes(feed[i])
    }
    if (!storiesFeed.isMoreAvailable) {
      console.log('Обработаны все сторис')
      break
    }
    await helpers.delay(3, 7)
  }
  // const reels = ig.feed.reelsMedia({
  //   userIds: [targetId]
  // })
  // while (true) {
  //   console.log('Делаем запрос')
  //   let items = await reels.items()
  //   if (!items.length) {
  //     console.log('No stories to watch')
  //     process.exit(0)
  //   }
  //   for (let i = 0; i < items.length; i++) {
  //     const post = items[i];
  //     parseJSONRes(post)
  //     await helpers.delay(3, 7);
  //     await ig.story.seen([post])
  //   }
  // }
}
async function getUsrFeed(targetId) {
  const feed = ig.feed.user(targetId)
  let counter = 0
  while (true) {
    const feedLst = await feed.items()
    if (counter == 0 && feedLst[0].user.is_private) {
      throw new Error(`Профиль ${feedLst[0].user.username} приватный. Подпишитесь для парсинга данного пользователя`)
    }
    for (let i = 0; i < feedLst.length; i++) {
      await parseJSONRes(feedLst[i])
    }
    console.log(`Обработали ${++counter} выдачу`)
    await helpers.delay(3, 10)
  }
}
async function getTagFeed(targetLink) {
  const feed = ig.feed.tag(targetLink)
  while (true) {
    const tagFeed = await feed.items()
    for (let i = 0; i < tagFeed.length; i++) {
      await parseJSONRes(tagFeed[i])
    }
    console.log(`Обработали ${++counter} выдачу`)
    // console.log(`Ждем ${randSeconds} секунд`)
    console.log(`Ждем несколько секунд перед следующим запросом`)
    await helpers.delay(3, 10);
  }
}
async function parseJSONRes(obj) {
  // try {
  switch (obj.media_type) {
    case 1:
    case 2:
      isCarousel = false
      await parseOneTime(obj)
      break
    case 8: {
      // console.log('Работаем с каруселью')
      isCarousel = true
      carouselCounter += 1
      obj.carousel_media.forEach((carouselPost, i) => {
        parseOneTime(carouselPost, i)
      })
      break
    }
  }
  // } catch (e) {
  //   throw new Error(`Ошибка при парсинге ответа от сервера: ${e}`)
  // }
}
async function parseOneTime(obj, i = null) {
  // try {
  switch (obj.media_type) {
    case 1: {
      let folderName
      if (!isCarousel) {
        folderName = path.join(targetLink.replace('\s*', '').replace(/[\\/:\*\?"<>\|]+/, '_'), 'Фото')
        photoCounter += 1
      } else {
        folderName = path.join(targetLink.replace('\s*', '').replace(/[\\/:\*\?"<>\|]+/, '_'), 'Карусель', String(carouselCounter))
      }
      // console.log('Работаем с фотографией')
      const photoUrl = obj.image_versions2.candidates[0].url
      // console.log(photoUrl)
      let fileName
      // if (checkRandomizePhotoNames) {
      fileName = helpers.randomString(7, 18)
      // } else {
      //   if (!isCarousel) {
      //     fileName = photoCounter
      //   } else {
      //     filename = i
      //   }
      // }
      // await download(photoUrl, folderName, `${fileName}.jpg`)
      console.log(`Обработали ${++commonCounter} пост`)
      break
    }
    case 2: {
      if (checkGetVideo) {
        let folderName
        if (!isCarousel) {
          folderName = path.join(targetLink.replace('\s*', '').replace(/[\\/:\*\?"<>\|]+/, '_'), 'Видео')
          videoCounter += 1
        } else {
          folderName = path.join(targetLink.replace('\s*', '').replace(/[\\/:\*\?"<>\|]+/, '_'), 'Карусель', String(carouselCounter))
        }
        // console.log('Работаем с видео')
        const videoUrl = obj.video_versions[0].url
        // console.log(videoUrl)
        let fileName
        // if (checkRandomizePhotoNames) {
        fileName = helpers.randomString(7, 18)
        // } else {
        //   if (!isCarousel) {
        //     fileName = photoCounter
        //   } else {
        //     filename = i
        //   }
        // }
        /*if (checkRandomizePhotoNames) {
          fileName = helpers.randomString(7, 18)
        } else {
          if (!isCarousel) {
            fileName = videoCounter
          } else {
            filename = i
          }
        }*/
        // await download(videoUrl, folderName, `${fileName}.mp4`)
        console.log(`Обработали ${++commonCounter} пост`)
      }
      break
    }
  }
  // Завершаем скрипт с успехом
  if (commonCounter >= postsParseLimit) {
    process.exit(0)
  }
  // } catch (e) {
  //   throw new Error(`Ошибка при парсинге поста: ${e}`)
  // }
}
async function download(url, folderName, fileName) {
  // try {
  const Path = path.join(path.normalize(downloadPath), folderName)
  if (!fs.existsSync(Path)) {
    fs.mkdirSync(Path, { recursive: true })
  }
  const fullPath = path.join(Path, fileName)
  const res = await fetch(url)
  await res.body.pipe(fs.createWriteStream(fullPath))
  // } catch (e) {
  //   throw new Error(`Ошибка при скачивании фото: ${e}\n\nСсылка на фото: ${url}\nПуть скачивания фото: ${fullPath}`)
  // }
}

const helpers = {
  random(min, max) {
    return Math.floor(min + Math.random() * (max + 1 - min))
  },
  delay(min, max) {
    const rand = this.random(min, max)
    console.log(`Ждем ${rand} секунд`)
    return new Promise(res => setTimeout(() => res(), rand * 1000))
  },
  randomString(min, max) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789' // ABCDEFGHIJKLMNOPQRSTUVWXYZ
    let res = ''
    const len = this.random(min, max)
    for (var i = 0; i < len; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    console.log(res)
    return res
  }
}









