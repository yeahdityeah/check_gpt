environment=${1:-prod}
dir=${2}
ref=${3}
export PATH=$PATH:~/development/flutter/bin/
# cd ~/development/flutter_dev/playox

cd ~/apps/playox_app/
flutter build apk --dart-define=env=$environment --dart-define=refid=$ref

echo $dir
mv build/app/outputs/flutter-apk/app-release.apk ${dir}/theOXAppBeta.apk

flutter build apk --dart-define=env=prod --dart-define=refid=gjfdek

#mkdir /home/ec2-user/apps/playox_server/static/gjfdek
#mv build/app/outputs/flutter-apk/app-release.apk /home/ec2-user/apps/playox_server/static/gjfdek/theOXAppBeta.apk